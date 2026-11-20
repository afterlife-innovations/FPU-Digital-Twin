"""
pack_observer.py - plug-and-play Kalman observer for an 8S x 11P NMC pack
read by a JK-BD6A24S6P BMS.  Pure Python 3 (no numpy).  One 12-state EKF
per series bank: 11 cell SOCs + one capacity state u = 1/scale.

Cell passport metrics are supplied by the current assembly-map pull; there is no
CSV file input. Observer-only defaults are used for unmapped cells or missing
passport fields.

SIGN CONVENTION: inside the filter discharge current is POSITIVE. The installed
BMS reports discharge as POSITIVE, so the observer uses the reported current
without inversion. BMS readings and observer estimates are delivered through
the backend telemetry ingest pipeline and CSV logger.

SOH (REVISED): capacity is no longer computed from rest anchors.  It is a
continuously estimated state of the same Kalman filter that estimates SOC, and
the published SOH is refreshed every soh_period_s (default 20 s).  How much
that estimate can move per refresh is decided by the covariance mathematics
(Ah moved, OCV slope, noise), not by a rest-time gate.

SOURCE LEGEND used in comments
  [S2] user-supplied OCV table (origin unverified)
  [S3] JK-BD6A24S6P manual
  [U]  stated by the user (use case, balancer behaviour)
  [T]  DERIVED from the OCV table by the code below
  [D]  design choice (no literature backing; tune on your own data)
"""
import json
import math
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone


# =============================================================================
# 1. OCV-SOC table [S2] and everything derived from it [T]
#    SOC in percent, OCV in volts.  Must be strictly increasing in both columns.
# =============================================================================
SOC_PTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
OCV_PTS = [3.34, 3.53, 3.59, 3.63, 3.66, 3.70, 3.75, 3.83, 3.92, 4.03, 4.13]


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def _seg(s_pct):
    """Index k of the table segment [SOC_PTS[k], SOC_PTS[k+1]] containing s_pct."""
    for k in range(len(SOC_PTS) - 1):
        if s_pct <= SOC_PTS[k + 1]:
            return k
    return len(SOC_PTS) - 2


def _build_table_stats():
    """Everything below is computed from SOC_PTS/OCV_PTS only.

    h_k      segment width (fraction of SOC)
    s_k      segment slope H_k = dOCV/dSOC in volts per UNIT SOC
    c_j      curvature f'' at interior knot j (non-uniform-grid second difference)
    e_k      worst-case piecewise-linear interpolation error on segment k, volts:
             e_k = h_k^2/8 * max(|f''| at the segment's two knots)
             (standard bound for linear interpolation of a smooth function)
    """
    n = len(SOC_PTS) - 1
    h = [(SOC_PTS[k + 1] - SOC_PTS[k]) / 100.0 for k in range(n)]
    s = [(OCV_PTS[k + 1] - OCV_PTS[k]) / h[k] for k in range(n)]
    c = [0.0] * (n + 1)
    for j in range(1, n):
        c[j] = 2.0 * (s[j] - s[j - 1]) / (h[j] + h[j - 1])
    c[0], c[n] = c[1], c[n - 1]                       # end knots: reuse nearest interior value
    e = [h[k] ** 2 / 8.0 * max(abs(c[k]), abs(c[k + 1])) for k in range(n)]
    return h, s, c, e


SEG_H, SEG_SLOPE, KNOT_CURV, SEG_ERR = _build_table_stats()


def ocv(soc):
    """SOC fraction (0..1) -> volts, piecewise linear, clamped to the table ends."""
    s = _clamp(soc * 100.0, SOC_PTS[0], SOC_PTS[-1])
    k = _seg(s)
    f = (s - SOC_PTS[k]) / (SOC_PTS[k + 1] - SOC_PTS[k])
    return OCV_PTS[k] + f * (OCV_PTS[k + 1] - OCV_PTS[k])


def d_ocv(soc):
    """Slope H = dOCV/dSOC in volts per UNIT SOC (fraction) [T]."""
    return SEG_SLOPE[_seg(_clamp(soc * 100.0, SOC_PTS[0], SOC_PTS[-1]))]


def interp_err_v(soc):
    """Worst-case interpolation error of the table at this SOC, volts [T]."""
    return SEG_ERR[_seg(_clamp(soc * 100.0, SOC_PTS[0], SOC_PTS[-1]))]


def soc_from_ocv(v):
    """Inverse lookup: volts -> SOC fraction (clamped to 0..1 outside the table)."""
    if v <= OCV_PTS[0]:
        return 0.0
    if v >= OCV_PTS[-1]:
        return 1.0
    for k in range(len(OCV_PTS) - 1):
        if v <= OCV_PTS[k + 1]:
            f = (v - OCV_PTS[k]) / (OCV_PTS[k + 1] - OCV_PTS[k])
            return (SOC_PTS[k] + f * (SOC_PTS[k + 1] - SOC_PTS[k])) / 100.0
    return 1.0


# =============================================================================
# 2. Tunable parameters.  Every value is tagged with its source.
# =============================================================================
@dataclass
class Params:
    # ---- sensor and noise model --------------------------------------------
    sigma_sensor: float = 0.005     # [S3]/[D] V; manual +/-3 mV, other JK listings +/-5 mV
    r_delta: float = 0.4            # [D] fractional uncertainty in the I*R correction
    relax_a: float = 0.020          # [D] V, voltage uncertainty the instant current stops
    relax_tau: float = 600.0        # [D] s, decay time of that uncertainty (calibrate on data)
    rest_a: float = 0.05            # [D] A, |pack current| below this counts as rest
    table_acc_v: float = 0.0        # [D] V, TRUE accuracy of the OCV table. UNKNOWN -> 0.
                                    #     Raise it if you learn the table's provenance; it is
                                    #     added to the REPORTED sigma (not to the filter gain).
    # ---- initial / process uncertainty -------------------------------------
    sigma_indep0: float = 0.003     # [D] cell-to-cell independent SOC uncertainty allowance
    q_rate: float = 1e-8 / 3.0      # [D] common-mode process noise, fraction^2 per second
    q_indep_rate: float = 1e-8 / 30.0  # [D] independent per-cell process noise per second
    # ---- continuous capacity (SOH) state -----------------------------------
    soh_period_s: float = 20.0      # [U] publish SOH every 20 s
    u_sigma0: float = 0.05          # [D] initial doubt in the passport capacity (fraction)
    q_u_rate: float = (0.01 ** 2) / 86400.0   # [D] lets u drift ~1 % per day (fraction^2/s)
    u_freeze_relax_v: float = 0.005  # [S3]/[D] freeze u while relaxation doubt > sensor level
    cap_lo_frac: float = 0.5        # [D] plausibility floor, fraction of nominal capacity
    cap_hi_frac: float = 1.2        # [D] plausibility ceiling, fraction of nominal capacity
    # ---- balancer ([U] constant 0.6 A when ON, no sign, no bank attribution) ------
    bal_current_a: float = 0.6      # [U][S3] balancer current when ON
    bal_on_a: float = 0.05          # [D] reported balance current above this means ON
    bal_mode: str = "uncertain"     # "uncertain" | "heuristic" | "off"   [D]
    bal_active_prob: float = 0.25   # [D] chance a given bank is donor or recipient (2 of 8)
    bal_horizon_s: float = 600.0    # [D] s over which an unmodelled balancer bias is corrected
    bal_tie_v: float = 0.002        # [D] V, banks within this of max/min count as tied
    bal_freeze_ratio: float = 50.0  # [D] freeze u if balancing and |I| < ratio*0.6 A (bias <= 2 %)
    # ---- temperature --------------------------------------------------------
    ea_ev: float = 0.0              # [D] Arrhenius energy; 0 disables temperature correction
    t_ref_c: float = 25.0           # [D] passport DCIR reference temperature (assumed)
    # ---- gaps and power-off [U] ---------------------------------------------
    gap_policy: str = "off"         # "off": a data gap = pack switched off (no load).  [U]
                                    # "unknown": a gap may hide load (old behaviour)
    tail_s: float = 10.0            # [D] s of unlogged load before a switch-off
    max_dt: float = 60.0            # [D] s, a gap longer than this is handled as a gap
    sub_dt: float = 30.0            # [D] s, largest predict sub-step inside a gap
    equalize_s: float = 3600.0      # [D] s, rest gaps longer than this equalise analytically
    gap_load_frac: float = 0.5      # [D] uncertainty on charge moved in a gap that may hide load
    gap_cap_sigma: float = 0.30     # [D] cap on that uncertainty (fraction SOC)
    v_ok_min: float = 2.0           # [D] V, reject bank voltages outside this window
    v_ok_max: float = 4.6           # [D] V


def soc_sigma_from_voltage(soc, p, extra_var_v=0.0):
    """Initial SOC uncertainty derived from the table [T] and the sensor spec:

        sigma_SOC = sqrt(sigma_sensor^2 + e_interp(SOC)^2 + extra) / H(SOC)

    Replaces the old hand-picked 3 %.  Steep regions give small sigma, flat ones large."""
    return math.sqrt(p.sigma_sensor ** 2 + interp_err_v(soc) ** 2 + extra_var_v) / d_ocv(soc)


# =============================================================================
# 3. Cell passport and bank parameters
# =============================================================================
@dataclass
class Cell:
    nominal_ah: float
    dcir_ohm: float
    measured_ah: float = None
    soh_percent: float = 100.0
    has_nominal_capacity: bool = False
    has_capacity_baseline: bool = False
    has_soh_baseline: bool = False
    bank: int = 1
    position: int = 1


def bank_params(cells):
    """Reference capacity per cell = measured Ah; if absent, nominal x SOH%."""
    cap_nom = sum(c.nominal_ah for c in cells)
    caps = [c.measured_ah if c.measured_ah else c.nominal_ah * c.soh_percent / 100.0
            for c in cells]
    G = [1.0 / c.dcir_ohm for c in cells]
    return cap_nom, caps, G


def r_temp_factor(t_c, t_ref_c=25.0, ea_ev=0.0):
    if ea_ev == 0.0:
        return 1.0
    k_b = 8.617333e-5
    return math.exp((ea_ev / k_b) * (1.0 / (t_c + 273.15) - 1.0 / (t_ref_c + 273.15)))


def split_currents(x, G, i_bank):
    """Shared-voltage Rint solution.  Returns (V_bank, [OCV_i], [I_i]); sum(I_i) = i_bank."""
    o = [ocv(s) for s in x]
    sg = sum(G)
    v = (sum(g * oo for g, oo in zip(G, o)) - i_bank) / sg
    return v, o, [(oo - v) * g for oo, g in zip(o, G)]


# --- tiny matrix helpers -------------------------------------------------------
def _T(A):
    return [list(r) for r in zip(*A)]


def _matmul(A, B):
    Bt = _T(B)
    return [[sum(a * b for a, b in zip(row, col)) for col in Bt] for row in A]


def init_cov(n, sigma_common, sigma_indep, sigma_u):
    """(n+1)x(n+1): SOC block P_ij = sigma_common^2 (+ sigma_indep^2 on the diagonal)
    because table/sensor errors are common to every cell; capacity state u last."""
    c2, i2 = sigma_common ** 2, sigma_indep ** 2
    P = [[0.0] * (n + 1) for _ in range(n + 1)]
    for i in range(n):
        for j in range(n):
            P[i][j] = c2 + (i2 if i == j else 0.0)
    P[n][n] = sigma_u ** 2
    return P


# =============================================================================
# 4. One series bank = one (n+1)-state EKF   z = [SOC_1..SOC_n, u],  u = 1/scale
#    cell capacity C_i = C0_i / u   (C0_i from the passport)
# =============================================================================
class BankObserver:
    def __init__(self, cells, v0, i0=0.0, t_c0=25.0, params=None):
        self.p = params or Params()
        self.n = len(cells)
        self.nominal_caps = [c.nominal_ah for c in cells]
        self.cap_nom, self.caps0, self.G0 = bank_params(cells)
        self.u = 1.0                                         # capacity state
        rf = r_temp_factor(t_c0, self.p.t_ref_c, self.p.ea_ev)
        r_bank0 = rf / sum(self.G0)
        loaded = abs(i0) >= self.p.rest_a
        x0 = soc_from_ocv(v0 + i0 * r_bank0)                 # OCV = V + I*R (discharge +)
        self.x = [x0] * self.n
        # [T] starting SOC uncertainty from the table slope, interpolation error, sensor spec.
        # Rested start: rest history unknown -> assume the full relaxation doubt.
        # Loaded start: the I*R correction doubt replaces it.
        extra = (self.p.r_delta * abs(i0) * r_bank0) ** 2 if loaded else self.p.relax_a ** 2
        self.sigma0 = soc_sigma_from_voltage(x0, self.p, extra)
        self.P = init_cov(self.n, self.sigma0, self.p.sigma_indep0, self.p.u_sigma0)
        self.rest_t = 0.0
        self.last_i_pack = i0
        self.pub, self.t_pub = None, 0.0

    # -- derived quantities ----------------------------------------------------
    def caps(self):
        return [c / self.u for c in self.caps0]

    def cap_bank(self):
        return sum(self.caps0) / self.u

    def soc_bank(self):
        sc = sum(self.caps0)
        return sum(c * x for c, x in zip(self.caps0, self.x)) / sc

    def sigma_bank(self):
        sc = sum(self.caps0)
        w = [c / sc for c in self.caps0]
        var = sum(w[i] * self.P[i][j] * w[j] for i in range(self.n) for j in range(self.n))
        return math.sqrt(max(var, 0.0))

    def soh(self):
        return self.cap_bank() / self.cap_nom

    def sigma_soh(self):
        """SOH = sum(C0)/(u*cap_nom)  ->  sigma_SOH = SOH * sigma_u / u."""
        return self.soh() * math.sqrt(max(self.P[self.n][self.n], 0.0)) / self.u

    def u_bounds(self):
        sc = sum(self.caps0)
        return sc / (self.p.cap_hi_frac * self.cap_nom), sc / (self.p.cap_lo_frac * self.cap_nom)

    # -- covariance helpers -----------------------------------------------------
    def _add_common(self, var):
        for i in range(self.n):
            for j in range(self.n):
                self.P[i][j] += var

    # -- predict ---------------------------------------------------------------
    def _predict_once(self, h, i_bank, G, extra_qc):
        n, N, sg, u = self.n, self.n + 1, sum(G), self.u
        d = [d_ocv(s) for s in self.x]
        _, _, Ii = split_currents(self.x, G, i_bank)
        k_i = [h * u / (3600.0 * self.caps0[i]) for i in range(n)]
        F = [[0.0] * N for _ in range(N)]
        for i in range(n):
            for j in range(n):
                F[i][j] = (1.0 if i == j else 0.0) \
                    - k_i[i] * G[i] * ((d[j] if i == j else 0.0) - G[j] * d[j] / sg)
            F[i][n] = -Ii[i] * h / (3600.0 * self.caps0[i])       # dx_i/du
        F[n][n] = 1.0
        self.x = [_clamp(self.x[i] - Ii[i] * k_i[i], 0.0, 1.0) for i in range(n)]
        P = _matmul(_matmul(F, self.P), _T(F))
        qc = (self.p.q_rate + extra_qc) * h
        qi = self.p.q_indep_rate * h
        for i in range(n):
            for j in range(n):
                P[i][j] += qc + (qi if i == j else 0.0)
        P[n][n] += self.p.q_u_rate * h
        self.P = P

    def _predict_span(self, dt, i_bank, G, extra_qc=0.0):
        if dt <= 0.0:
            return
        n_sub = max(1, int(math.ceil(dt / self.p.sub_dt)))
        h = dt / n_sub
        for _ in range(n_sub):
            self._predict_once(h, i_bank, G, extra_qc)

    def _equalize(self, dt):
        """Long rest: cells share one OCV, so all converge to the charge-weighted mean SOC."""
        n = self.n
        sc = sum(self.caps0)
        w = [c / sc for c in self.caps0]
        mean = sum(wi * xi for wi, xi in zip(w, self.x))
        var = sum(w[i] * self.P[i][j] * w[j] for i in range(n) for j in range(n))
        var += self.p.q_rate * dt
        pxu = sum(w[i] * self.P[i][n] for i in range(n))
        puu = self.P[n][n] + self.p.q_u_rate * dt
        self.x = [mean] * n
        self.P = init_cov(n, math.sqrt(var), self.p.sigma_indep0, math.sqrt(puu))
        for i in range(n):
            self.P[i][n] = self.P[n][i] = pxu

    def _advance_rest(self, dt, i_bank, G, extra_qc=0.0):
        if dt >= self.p.equalize_s and abs(i_bank) < self.p.rest_a:
            self._equalize(dt)
        else:
            self._predict_span(dt, i_bank, G, extra_qc)

    # -- one sample ------------------------------------------------------------
    def step(self, v_meas, i_pack, dt, t_c=25.0, i_bal_in=0.0, bal_uncertain=False):
        """Process one BMS sample.

        v_meas  bank terminal voltage (V)          i_pack  pack current, DISCHARGE +
        dt      seconds since previous sample      t_c     temperature (deg C)
        i_bal_in       amps the balancer pushes INTO this bank (known assignment)
        bal_uncertain  balancer is ON but this bank's role is unknown
        """
        p, n, N = self.p, self.n, self.n + 1
        rf = r_temp_factor(t_c, p.t_ref_c, p.ea_ev)
        G = [g / rf for g in self.G0]                        # R scaled by rf -> G divided
        sg = sum(G)
        r_bank = 1.0 / sg
        c_bank = self.cap_bank()
        i_bank = i_pack - i_bal_in
        flags = []
        if dt < 0.0:
            dt = 0.0
            flags.append("CLOCK_BACKWARDS")

        # [T]/[D] unknown-role balancer -> extra common-mode process noise (fraction^2/s):
        # variance of a +/-0.6 A bias (prob. p of being donor/recipient) turned into a
        # random-walk rate over the horizon in which the voltage can correct it.
        q_bal = 0.0
        if bal_uncertain:
            sig_b2 = p.bal_active_prob * p.bal_current_a ** 2
            q_bal = sig_b2 * p.bal_horizon_s / (3600.0 * c_bank) ** 2
            flags.append("BAL_UNCERTAIN")

        rest_add = dt
        if dt > p.max_dt:                                    # ---- GAP
            i_last = self.last_i_pack
            if p.gap_policy == "off":                        # [U] gap = pack switched off
                flags.append("GAP_OFF")
                self._add_common((abs(i_last) * p.tail_s / (3600.0 * c_bank)) ** 2)
                self._advance_rest(dt, 0.0, G)
            elif abs(i_last) < p.rest_a and abs(i_pack) < p.rest_a:
                flags.append("GAP_REST")
                self._advance_rest(dt, i_bank, G, q_bal)
            else:
                flags.append("GAP_LOAD")                     # load may have run unseen
                i_eff = 0.5 * (i_last + i_pack) - i_bal_in
                self._predict_span(dt, i_eff, G, q_bal)
                var = min((p.gap_load_frac * abs(i_eff) * dt / (3600.0 * c_bank)) ** 2,
                          p.gap_cap_sigma ** 2)
                self._add_common(var)
                for i in range(n):                           # unseen charge is independent of u
                    self.P[i][n] = self.P[n][i] = 0.0
                rest_add = 0.0
        else:                                                # ---- normal sample
            self._predict_span(dt, i_bank, G, q_bal)

        valid = v_meas is not None and p.v_ok_min <= v_meas <= p.v_ok_max
        if not valid:
            flags.append("VOLTAGE_REJECTED")

        resting = abs(i_pack) < p.rest_a
        self.rest_t = self.rest_t + rest_add if resting else 0.0
        relax_sd = p.relax_a * math.exp(-self.rest_t / p.relax_tau) if resting else 0.0

        # ---- should the capacity state be corrected this sample? ----------------
        freeze_u = False
        if resting and relax_sd > p.u_freeze_relax_v:        # post-load relaxation transient
            freeze_u = True
            flags.append("U_FROZEN_RELAX")
        if (bal_uncertain or i_bal_in != 0.0) and abs(i_pack) < p.bal_freeze_ratio * p.bal_current_a:
            freeze_u = True                                  # 0.6 A is a large share of the load
            flags.append("U_FROZEN_BAL")

        innov, S, sigma_v = 0.0, 0.0, 0.0
        v_hat, _, _ = split_currents(self.x, G, i_bank)
        if valid:                                            # ---- UPDATE
            x_bar = self.soc_bank()
            d = [d_ocv(s) for s in self.x]
            H = [G[j] * d[j] / sg for j in range(n)] + [0.0]
            # [T] table interpolation error enters Rn; sensor, I*R and relaxation as before
            var_v = (p.sigma_sensor ** 2 + (p.r_delta * abs(i_bank) * r_bank) ** 2
                     + interp_err_v(x_bar) ** 2 + relax_sd ** 2)
            sigma_v = math.sqrt(var_v)
            PHt = [sum(self.P[i][j] * H[j] for j in range(N)) for i in range(N)]
            S = sum(H[i] * PHt[i] for i in range(N)) + var_v         # S = H P H' + Rn
            K = [q / S for q in PHt]                                  # K = P H' / S
            if freeze_u:
                K[n] = 0.0                  # Schmidt-Kalman: u is "considered", not corrected
            innov = v_meas - v_hat
            self.x = [_clamp(self.x[i] + K[i] * innov, 0.0, 1.0) for i in range(n)]
            u_lo, u_hi = self.u_bounds()
            self.u = _clamp(self.u + K[n] * innov, u_lo, u_hi)
            A = [[(1.0 if i == j else 0.0) - K[i] * H[j] for j in range(N)] for i in range(N)]
            P = _matmul(_matmul(A, self.P), _T(A))                    # Joseph form (any gain)
            for i in range(N):
                for j in range(N):
                    P[i][j] += K[i] * var_v * K[j]
            self.P = [[0.5 * (P[i][j] + P[j][i]) for j in range(N)] for i in range(N)]

        # ---- publish SOH every soh_period_s of data time ----------------------------
        self.t_pub += dt
        soh_updated = False
        if self.pub is None or self.t_pub >= p.soh_period_s:
            self.pub = {"soh_pct": 100 * self.soh(), "cap_ah": self.cap_bank(),
                        "soh_sigma_pct": 100 * self.sigma_soh(), "u": self.u}
            self.t_pub = 0.0
            soh_updated = True

        self.last_i_pack = i_pack
        _, o, Ii = split_currents(self.x, G, i_bank)
        x_bar = self.soc_bank()
        sig_prec = self.sigma_bank()
        sig_sys = (interp_err_v(x_bar) + p.table_acc_v) / d_ocv(x_bar)   # systematic floor [T]
        cell_capacity = self.caps()
        return {
            "soc_bank_pct": 100 * x_bar,
            "soc_sigma_prec_pct": 100 * sig_prec,
            "soc_sigma_pct": 100 * math.sqrt(sig_prec ** 2 + sig_sys ** 2),
            "soh_pct": self.pub["soh_pct"], "soh_sigma_pct": self.pub["soh_sigma_pct"],
            "cap_bank_ah": self.pub["cap_ah"], "soh_updated": soh_updated,
            "r_bank_mohm": 1e3 * r_bank,
            "cell_soc_pct": [100 * s for s in self.x],
            "cell_capacity_ah": cell_capacity,
            "cell_soh_pct": [
                100 * capacity / nominal
                for nominal, capacity in zip(self.nominal_caps, cell_capacity)
            ],
            "cell_current_a": Ii, "cell_ocv_v": o,
            "v_pred": v_hat, "innovation_v": innov, "S": S, "sigma_v": sigma_v,
            "rest_s": self.rest_t, "flags": flags, "estimation_method": "KALMAN_OBSERVER",
        }

    # -- persistence -----------------------------------------------------------
    def get_state(self):
        return {"x": self.x, "P": self.P, "u": self.u, "rest_t": self.rest_t,
                "last_i_pack": self.last_i_pack, "pub": self.pub, "t_pub": self.t_pub}

    def set_state(self, s):
        for k, v in s.items():
            setattr(self, k, v)


# =============================================================================
# 5. Whole-pack observer (8 banks)
# =============================================================================
class PackObserver:
    STATE_VERSION = 2

    def __init__(self, bank_cells, params=None, state_path=None,
                 reset_clock=False):
        self.bank_cells = bank_cells
        self.p = params or Params()
        self.state_path, self.banks = state_path, None
        self.last_ts, self.last_i_pack = None, None
        self._pending_state = None
        self.rem_prev, self.d_rem, self.d_ah = None, 0.0, 0.0    # BMS-counter cross-check
        if state_path and os.path.exists(state_path):
            self._load(reset_clock)

    def _signature(self):
        return [[[round(c.nominal_ah, 4), round(c.dcir_ohm, 6),
                  round(c.measured_ah or 0.0, 4),
                  round(c.soh_percent, 2), c.bank, c.position]
                 for c in cells] for cells in self.bank_cells]

    def _load(self, reset_clock):
        try:
            with open(self.state_path) as f:
                s = json.load(f)
            if s.get("version") != self.STATE_VERSION or s.get("signature") != self._signature():
                print("WARNING: saved state does not match this passport/version - ignoring it.",
                      file=sys.stderr)
                return
            self._pending_state = s["banks"]
            self.last_ts = None if reset_clock else s.get("last_ts")
            self.last_i_pack = s.get("last_i_pack")
        except (OSError, ValueError, KeyError) as e:
            print(f"WARNING: could not read state ({e}) - starting cold.", file=sys.stderr)

    def save(self):
        if not self.state_path or self.banks is None:
            return
        s = {"version": self.STATE_VERSION, "signature": self._signature(),
             "last_ts": self.last_ts, "last_i_pack": self.last_i_pack,
             "banks": [b.get_state() for b in self.banks]}
        d = os.path.dirname(os.path.abspath(self.state_path))
        fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(s, f)
        os.replace(tmp, self.state_path)                    # atomic: no half-written state

    def _balance_assign(self, bank_v, on):
        """Per-bank (known balancer current in, role-unknown flag) from the ON flag [U].
        The BMS gives one unsigned 0.6 A for the whole pack, so the bank is guessed."""
        n, p = len(bank_v), self.p
        if not on or p.bal_mode == "off":
            return [0.0] * n, [False] * n
        if p.bal_mode == "uncertain":
            return [0.0] * n, [True] * n
        # heuristic: the manual [S3] says energy moves from higher cells to lower cells.
        vmax, vmin = max(bank_v), min(bank_v)
        if vmax - vmin < p.bal_tie_v:
            return [0.0] * n, [True] * n
        don = [k for k, v in enumerate(bank_v) if v >= vmax - p.bal_tie_v]
        rec = [k for k, v in enumerate(bank_v) if v <= vmin + p.bal_tie_v]
        i_in, unc = [0.0] * n, [False] * n
        for grp, sign in ((don, -1.0), (rec, +1.0)):
            if len(grp) == 1:
                i_in[grp[0]] = sign * p.bal_current_a
            else:
                for k in grp:
                    unc[k] = True                              # tied: role cannot be assigned
        return i_in, unc

    def ingest(
        self,
        ts,
        bank_v,
        current_magnitude_a,
        temps,
        balance_on=False,
        remaining_ah=None,
        operating_mode="IDLE",
    ):
        """Process one complete BMS frame.

        current_magnitude_a remains nonnegative; operating_mode supplies direction.
        The observer's discharge-positive model derives its signed current from
        those separate inputs for coulomb counting.
        """
        current_magnitude_a = abs(float(current_magnitude_a))
        if operating_mode == "DISCHARGING":
            i_pack = current_magnitude_a
        elif operating_mode == "CHARGING":
            i_pack = -current_magnitude_a
        else:
            i_pack = 0.0
        t_c = sum(temps) / len(temps)

        if self.banks is None:
            self.banks = [BankObserver(c, v, i0=i_pack, t_c0=t_c, params=self.p)
                          for c, v in zip(self.bank_cells, bank_v)]
            if self._pending_state:
                for b, s in zip(self.banks, self._pending_state):
                    b.set_state(s)
                self._pending_state = None

        dt = 0.0 if self.last_ts is None else ts - self.last_ts
        i_in, unc = self._balance_assign(bank_v, balance_on)
        outs = [b.step(v, i_pack, dt, t_c, i_in[k], unc[k])
                for k, (b, v) in enumerate(zip(self.banks, bank_v))]

        if remaining_ah is not None:                         # BMS counter vs our integral
            if self.rem_prev is not None and 0.0 < dt <= self.p.max_dt:
                self.d_rem += remaining_ah - self.rem_prev
                self.d_ah += i_pack * dt / 3600.0
            self.rem_prev = remaining_ah
        self.last_ts, self.last_i_pack = ts, i_pack

        caps = [o["cap_bank_ah"] for o in outs]
        return {
            "ts": ts, "dt": dt, "current_magnitude_a": current_magnitude_a,
            "operating_mode": operating_mode, "i_pack_discharge_pos": i_pack,
            "balance_on": balance_on,
            "banks": outs,
            "pack_soc_min_pct": min(o["soc_bank_pct"] for o in outs),
            "pack_soc_mean_pct": sum(c * o["soc_bank_pct"] for c, o in zip(caps, outs)) / sum(caps),
            "pack_cap_ah": min(caps), "soh_min_pct": min(o["soh_pct"] for o in outs),
        }

    def bms_counter_check(self):
        """(ratio, message).  ratio = -(change in BMS remaining Ah) / (our discharge Ah).
        +1 means the BMS counter and our current integral agree with the assumed sign;
        -1 means the sign convention is reversed."""
        if abs(self.d_ah) < 0.5:
            return None, "not enough charge moved (>= 0.5 Ah) to check the current sign"
        r = -self.d_rem / self.d_ah
        if 0.7 <= r <= 1.3:
            return r, f"current sign and scale agree with the BMS counter (ratio {r:.2f})"
        if -1.3 <= r <= -0.7:
            return r, f"SIGN LOOKS REVERSED (ratio {r:.2f}): flip --current-sign"
        return r, f"BMS counter and our integral disagree (ratio {r:.2f}): check scale/offset"


# =============================================================================
# 6. BMS text parser (JK-BD6A24S6P serial dump format)
#    The balance and remaining-capacity patterns are GUESSES at your firmware's
#    wording: verify against a real dump or override with --balance-regex /
#    --remaining-regex (first capture group = the number).
# =============================================================================
RE_PACK = re.compile(r"Pack:\s*([-+]?\d+(?:\.\d+)?)\s*V")
RE_CUR = re.compile(r"Current:\s*([-+]?\d+(?:\.\d+)?)\s*A")
RE_BANK = re.compile(r"Series\s+Bank\s+(\d+):\s*(\d+)\s*mV")
RE_TEMP = re.compile(
    r"Temps:\s*MOS\s*([-+]?\d+(?:\.\d+)?)\s*C\s*"
    r"T1\s*([-+]?\d+(?:\.\d+)?)\s*C\s*"
    r"T2\s*([-+]?\d+(?:\.\d+)?)\s*C"
)
RE_BAL_A = re.compile(r"Balanc\w*(?:\s+Cur\w*)?\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)\s*A\b", re.I)
RE_BAL_A_JSON = re.compile(r'"balancing_current_a"\s*:\s*([-+]?\d+(?:\.\d+)?)', re.I)
RE_BAL_ST = re.compile(r"Balanc\w*\s*[:=]?\s*(ON|OFF|ACTIVE|IDLE|YES|NO)\b", re.I)
RE_REM = re.compile(r"Remain\w*(?:\s+Cap\w*)?\s*[:=]?\s*([-+]?\d+(?:\.\d+)?)\s*Ah\b", re.I)
RE_REM_JSON = re.compile(r'"remaining_capacity_ah"\s*:\s*([-+]?\d+(?:\.\d+)?)', re.I)
RE_ISO = re.compile(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)")
RE_EPOCH = re.compile(r"(?:^|[\s\[])(\d{10}(?:\.\d+)?)(?:$|[\s\]])")


def set_custom_patterns(balance=None, remaining=None):
    global RE_BAL_A, RE_REM
    if balance:
        RE_BAL_A = re.compile(balance, re.I)
    if remaining:
        RE_REM = re.compile(remaining, re.I)


def _parse_ts(line):
    m = RE_ISO.search(line)
    if m:
        return datetime.fromisoformat(m.group(1).replace(" ", "T")).timestamp()
    m = RE_EPOCH.search(line)
    return float(m.group(1)) if m else None


def _scan_fields(line, blk):
    c = RE_CUR.search(line)
    if c and blk["current_a"] is None:
        blk["current_a"] = float(c.group(1))
    b = RE_BANK.search(line)
    if b:
        blk["banks"][int(b.group(1))] = int(b.group(2)) / 1000.0
    t = RE_TEMP.search(line)
    if t:
        blk["temps"] = [float(t.group(2)), float(t.group(3))]       # T1, T2 (MOS ignored)
    ba = RE_BAL_A.search(line) or RE_BAL_A_JSON.search(line)
    if ba and blk["balance_a"] is None:
        blk["balance_a"] = float(ba.group(1))
    else:
        bs = RE_BAL_ST.search(line)
        if bs and blk["balance_on"] is None:
            blk["balance_on"] = bs.group(1).upper() in ("ON", "ACTIVE", "YES")
    r = RE_REM.search(line) or RE_REM_JSON.search(line)
    if r and blk["remaining_ah"] is None:
        blk["remaining_ah"] = float(r.group(1))


def _decode_json_block(line):
    try:
        data = json.loads(line)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None

    raw_voltages = data.get("cell_voltages_v") or data.get("series_voltages_mv")
    if not isinstance(raw_voltages, list) or not raw_voltages:
        return None
    values = [float(value) / 1000.0 if float(value) > 100.0 else float(value) for value in raw_voltages]
    if len(values) >= 88:
        banks = {
            bank: sum(values[(bank - 1) * 11:bank * 11]) / 11.0
            for bank in range(1, 9)
        }
    elif len(values) >= 8:
        banks = {bank: values[bank - 1] for bank in range(1, 9)}
    else:
        return None

    temperatures = data.get("temperatures_c") or []
    timestamp = data.get("timestamp")
    timestamp_line = str(timestamp) if timestamp is not None else ""
    return {
        "ts_prefix": _parse_ts(timestamp_line) if timestamp_line else None,
        "pack_v": float(data.get("pack_voltage_v") or sum(banks.values())),
        "current_a": float(data.get("pack_current_a") or 0.0),
        "banks": banks,
        "temps": [float(value) for value in temperatures],
        "balance_a": float(data["balancing_current_a"]) if data.get("balancing_current_a") is not None else None,
        "balance_on": None,
        "remaining_ah": float(data["remaining_capacity_ah"]) if data.get("remaining_capacity_ah") is not None else None,
        "soc_percent": data.get("soc_percent"),
        "pack_id": data.get("pack_id"),
        "bms_protocol": data.get("bms_protocol"),
    }


def iter_blocks(lines):
    """Yield one dict per BMS packet."""
    blk, pending_ts = None, None
    for line in lines:
        json_blk = _decode_json_block(line.strip())
        if json_blk is not None:
            if blk is not None:
                yield blk
                blk = None
            yield json_blk
            continue

        pts = _parse_ts(line)
        m = RE_PACK.search(line)
        if m:
            if blk is not None:
                yield blk
            blk = {"ts_prefix": pts if pts is not None else pending_ts,
                   "pack_v": float(m.group(1)), "current_a": None, "banks": {},
                   "temps": None, "balance_a": None, "balance_on": None,
                   "remaining_ah": None, "soc_percent": None,
                   "pack_id": None, "bms_protocol": None}
            pending_ts = None
            _scan_fields(line, blk)
            continue
        if pts is not None and "Series" not in line and "Temps" not in line:
            pending_ts = pts
        if blk is not None:
            _scan_fields(line, blk)
    if blk is not None:
        yield blk


# =============================================================================
# 7. Hardcoded per-cell metric input
# =============================================================================
def load_cell_metrics(cell_parameters=None, n_banks=8, n_cells=11):
    """Build observer cells from current-map passport values, keyed by series/parallel."""
    cell_parameters = cell_parameters or []
    parameters_by_position = {
        (int(item["series"]), int(item["parallel"])): item
        for item in cell_parameters
    }
    banks = []
    for bank in range(1, n_banks + 1):
        cells = []
        for position in range(1, n_cells + 1):
            metrics = parameters_by_position.get((bank, position), {})
            measured_ah = metrics.get("measured_capacity_ah")
            nominal_ah = metrics.get("nominal_capacity_ah")
            dcir_mohm = metrics.get("dcir_mohm") or 30.0
            soh_percent = metrics.get("soh_percent")
            has_capacity_baseline = (
                measured_ah is not None
                or (nominal_ah is not None and soh_percent is not None)
            )
            has_soh_baseline = (
                nominal_ah is not None
                and (soh_percent is not None or measured_ah is not None)
            )
            nominal_ah_for_filter = nominal_ah or measured_ah or 2.5
            cells.append(Cell(nominal_ah=float(nominal_ah_for_filter),
                              measured_ah=float(measured_ah) if measured_ah is not None else None,
                              dcir_ohm=float(dcir_mohm) / 1000.0,
                              soh_percent=float(soh_percent) if soh_percent is not None else 100.0,
                              has_nominal_capacity=nominal_ah is not None,
                              has_capacity_baseline=has_capacity_baseline,
                              has_soh_baseline=has_soh_baseline,
                              bank=bank, position=position))
        banks.append(cells)
    return banks


def build_dashboard_payload(ts, blk, result, cell_metrics, pack_id, use_wall_time=False):
    """Create the dashboard's TelemetryPayload shape from one observer result."""
    bank_voltages = [blk["banks"][bank] for bank in sorted(blk["banks"])]
    mean_voltage = sum(bank_voltages) / len(bank_voltages)
    avg_temp = sum(blk["temps"]) / len(blk["temps"])
    cells = []
    counts = {"green": 0, "yellow": 0, "red": 0}

    for bank_index, bank_output in enumerate(result["banks"], 1):
        bank_voltage = bank_voltages[bank_index - 1]
        for cell_index, cell in enumerate(cell_metrics[bank_index - 1]):
            voltage_delta_mv = abs(bank_voltage - mean_voltage) * 1000.0
            status, trigger = "green", None
            if bank_voltage < 2.8 or bank_voltage > 4.25:
                status, trigger = "red", "voltage_v"
            elif bank_output["cell_soh_pct"][cell_index] < 60.0:
                status, trigger = "red", "soh_percent"
            elif cell.dcir_ohm * 1000.0 >= 75.0:
                status, trigger = "red", "dcir_mohm"
            elif avg_temp >= 55.0:
                status, trigger = "red", "temperature_c"
            elif voltage_delta_mv > 50.0:
                status, trigger = "yellow", "voltage_drift"
            elif bank_output["cell_soh_pct"][cell_index] < 80.0:
                status, trigger = "yellow", "soh_percent"
            elif cell.dcir_ohm * 1000.0 >= 50.0:
                status, trigger = "yellow", "dcir_mohm"
            elif avg_temp >= 45.0:
                status, trigger = "yellow", "temperature_c"
            counts[status] += 1

            capacity = bank_output["cell_capacity_ah"][cell_index]
            cells.append({
                "position": f"S{bank_index}-P{cell_index + 1}",
                "series": bank_index,
                "parallel": cell_index + 1,
                "voltage_v": round(bank_voltage, 3),
                "temperature_c": round(avg_temp, 1),
                "dcir_mohm": round(cell.dcir_ohm * 1000.0, 2),
                "soh_percent": (
                    round(bank_output["cell_soh_pct"][cell_index], 2)
                    if cell.has_soh_baseline else None
                ),
                "soc_percent": round(bank_output["cell_soc_pct"][cell_index], 2),
                "capacity_ah": round(capacity, 4) if cell.has_capacity_baseline else None,
                "nominal_capacity_ah": cell.nominal_ah if cell.has_nominal_capacity else None,
                "measured_capacity_ah": cell.measured_ah,
                "health_status": status,
                "trigger_metric": trigger,
            })

    current = blk["current_a"]
    pack_voltage = blk["pack_v"]
    timestamp = (
        datetime.now(timezone.utc).isoformat()
        if use_wall_time else datetime.fromtimestamp(ts, timezone.utc).isoformat()
    )
    return {
        "pack_id": pack_id,
        "timestamp": timestamp,
        "pack_current_a": round(current, 3),
        "pack_voltage_v": round(pack_voltage, 3),
        "balancing_current_a": blk.get("balance_a"),
        "remaining_capacity_ah": blk.get("remaining_ah"),
        "bms_protocol": "JK_BMS_KALMAN_OBSERVER",
        "summary": {
            "total_voltage_v": round(pack_voltage, 3),
            "avg_cell_voltage_v": round(mean_voltage, 3),
            "min_cell_voltage_v": round(min(bank_voltages), 3),
            "max_cell_voltage_v": round(max(bank_voltages), 3),
            "voltage_delta_mv": round((max(bank_voltages) - min(bank_voltages)) * 1000.0, 1),
            "avg_temperature_c": round(avg_temp, 1),
            "pack_current_a": round(current, 3),
            "green_count": counts["green"],
            "yellow_count": counts["yellow"],
            "red_count": counts["red"],
            "operating_mode": (
                "CHARGING" if current > 0.05 else
                "DISCHARGING" if current < -0.05 else "IDLE"
            ),
            "pack_power_w": round(pack_voltage * current, 2),
        },
        "cells": cells,
        "anomaly_flags": None,
    }


# =============================================================================
# 8. Table report: every constant derived from the OCV table [T]
# =============================================================================
def table_report(p=None):
    p = p or Params()
    print("Segment   slope H        curvature f''   interp err e_k      SOC err e_k/H   "
          "start sigma (rested)")
    for k in range(len(SEG_SLOPE)):
        mid = (SOC_PTS[k] + SOC_PTS[k + 1]) / 200.0
        e = SEG_ERR[k]
        s0 = soc_sigma_from_voltage(mid, p, p.relax_a ** 2)
        print(f"{SOC_PTS[k]:3d}-{SOC_PTS[k+1]:<3d}%  {SEG_SLOPE[k]:4.2f} V/unit "
              f"({1000*SEG_SLOPE[k]/100:4.1f} mV/%)  {KNOT_CURV[k]:+6.1f}..{KNOT_CURV[k+1]:+6.1f}"
              f"   {1000*e:6.2f} mV      {100*e/SEG_SLOPE[k]:5.2f} %        {100*s0:5.2f} %")
    print(f"(rested start sigma uses sigma_sensor={1000*p.sigma_sensor:.1f} mV and "
          f"relax_a={1000*p.relax_a:.1f} mV; curvature columns are knot values)")
