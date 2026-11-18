import httpx

cells = [
    {"position":"S1-P1","battery_code":"AFI-LIIO-18650-3DKCB","legacy_cell_id":"116"},
    {"position":"S1-P2","battery_code":"AFI-LIIO-18650-H5SES","legacy_cell_id":"153"},
    {"position":"S1-P3","battery_code":"AFI-LIIO-18650-Q69HB","legacy_cell_id":"75"},
    {"position":"S1-P4","battery_code":"AFI-LIIO-18650-5Z6C8","legacy_cell_id":"128"},
    {"position":"S1-P5","battery_code":"AFI-LIIO-18650-TQQCW","legacy_cell_id":"72"},
    {"position":"S1-P6","battery_code":"AFI-LIIO-18650-Q2XUW","legacy_cell_id":"92"},
    {"position":"S1-P7","battery_code":"AFI-LIIO-18650-H63CB","legacy_cell_id":"86"},
    {"position":"S1-P8","battery_code":"AFI-LIIO-18650-DJH9I","legacy_cell_id":"120"},
    {"position":"S1-P9","battery_code":"AFI-LIIO-18650-VB121","legacy_cell_id":"274"},
    {"position":"S1-P10","battery_code":"AFI-LIIO-18650-V7IQL","legacy_cell_id":"126"},
    {"position":"S1-P11","battery_code":"AFI-LIIO-18650-XXGZN","legacy_cell_id":"273"},
    {"position":"S2-P1","battery_code":"AFI-LIIO-18650-7THWX","legacy_cell_id":"113"},
    {"position":"S2-P2","battery_code":"AFI-LIIO-18650-SZW4U","legacy_cell_id":"265"},
    {"position":"S2-P3","battery_code":"AFI-LIIO-18650-1ORHX","legacy_cell_id":"250"},
    {"position":"S2-P4","battery_code":"AFI-LIIO-18650-VIZK3","legacy_cell_id":"32"},
    {"position":"S2-P5","battery_code":"AFI-LIIO-18650-FPZFQ","legacy_cell_id":"189"},
    {"position":"S2-P6","battery_code":"AFI-LIIO-18650-P64RQ","legacy_cell_id":"664"},
    {"position":"S2-P7","battery_code":"AFI-LIIO-18650-ZY22E","legacy_cell_id":"185"},
    {"position":"S2-P8","battery_code":"AFI-LIIO-18650-DMM7G","legacy_cell_id":"183"},
    {"position":"S2-P9","battery_code":"AFI-LIIO-18650-2QOL0","legacy_cell_id":"105"},
    {"position":"S2-P10","battery_code":"AFI-LIIO-18650-W91YS","legacy_cell_id":"235"},
    {"position":"S2-P11","battery_code":"AFI-LIIO-18650-8L2NN","legacy_cell_id":"180"},
    {"position":"S3-P1","battery_code":"AFI-LIIO-18650-G5DMN","legacy_cell_id":"21"},
    {"position":"S3-P2","battery_code":"AFI-LIIO-18650-Y6P81","legacy_cell_id":"595"},
    {"position":"S3-P3","battery_code":"AFI-LIIO-18650-AW8FD","legacy_cell_id":"192"},
    {"position":"S3-P4","battery_code":"AFI-LIIO-18650-JQV7L","legacy_cell_id":"333"},
    {"position":"S3-P5","battery_code":"AFI-LIIO-18650-KF9CA","legacy_cell_id":"194"},
    {"position":"S3-P6","battery_code":"AFI-LIIO-18650-ZLR5U","legacy_cell_id":"195"},
    {"position":"S3-P7","battery_code":"AFI-LIIO-18650-EIR9S","legacy_cell_id":"336"},
    {"position":"S3-P8","battery_code":"AFI-LIIO-18650-ZOUZJ","legacy_cell_id":"335"},
    {"position":"S3-P9","battery_code":"AFI-LIIO-18650-2N7KV","legacy_cell_id":"337"},
    {"position":"S3-P10","battery_code":"AFI-UNK-UNK-D8OX7","legacy_cell_id":"377"},
    {"position":"S3-P11","battery_code":"AFI-LIIO-18650-3O8NR","legacy_cell_id":"484"},
    {"position":"S4-P1","battery_code":"AFI-LIIO-18650-12PRV","legacy_cell_id":"172"},
    {"position":"S4-P2","battery_code":"AFI-LIIO-18650-POCI7","legacy_cell_id":"490"},
    {"position":"S4-P3","battery_code":"AFI-LIIO-18650-MX9SI","legacy_cell_id":"182"},
    {"position":"S4-P4","battery_code":"AFI-LIIO-18650-1Y3EQ","legacy_cell_id":"188"},
    {"position":"S4-P5","battery_code":"AFI-UNK-UNK-8XBAW","legacy_cell_id":"368"},
    {"position":"S4-P6","battery_code":"AFI-LIIO-18650-WESAM","legacy_cell_id":"459"},
    {"position":"S4-P7","battery_code":"AFI-UNK-UNK-PMI9E","legacy_cell_id":"223"},
    {"position":"S4-P8","battery_code":"AFI-LIIO-18650-PMEHG","legacy_cell_id":"574"},
    {"position":"S4-P9","battery_code":"AFI-LIIO-18650-NYMVB","legacy_cell_id":"491"},
    {"position":"S4-P10","battery_code":"AFI-LIIO-18650-HDF3D","legacy_cell_id":"457"},
    {"position":"S4-P11","battery_code":"AFI-LIIO-18650-ND7DR","legacy_cell_id":"117"},
    {"position":"S5-P1","battery_code":"AFI-LIIO-18650-XL6NY","legacy_cell_id":"272"},
    {"position":"S5-P2","battery_code":"AFI-LIIO-18650-Q42VW","legacy_cell_id":"275"},
    {"position":"S5-P3","battery_code":"AFI-LIIO-18650-X8C0N","legacy_cell_id":"269"},
    {"position":"S5-P4","battery_code":"AFI-LIIO-18650-JW2TV","legacy_cell_id":"270"},
    {"position":"S5-P5","battery_code":"AFI-LIIO-18650-5DDU9","legacy_cell_id":"267"},
    {"position":"S5-P6","battery_code":"AFI-LIIO-18650-VDLNQ","legacy_cell_id":"114"},
    {"position":"S5-P7","battery_code":"AFI-LIIO-18650-BQKGS","legacy_cell_id":"103"},
    {"position":"S5-P8","battery_code":"AFI-LIIO-18650-V354B","legacy_cell_id":"268"},
    {"position":"S5-P9","battery_code":"AFI-LIIO-18650-WSMNG","legacy_cell_id":"171"},
    {"position":"S5-P10","battery_code":"AFI-LIIO-18650-Z0G6Q","legacy_cell_id":"173"},
    {"position":"S5-P11","battery_code":"AFI-LIIO-18650-Q5FRX","legacy_cell_id":"168"},
    {"position":"S6-P1","battery_code":"AFI-LIIO-18650-J1NL0","legacy_cell_id":"641"},
    {"position":"S6-P2","battery_code":"AFI-LIIO-18650-UR1WK","legacy_cell_id":"25"},
    {"position":"S6-P3","battery_code":"AFI-LIIO-18650-J1MP2","legacy_cell_id":"26"},
    {"position":"S6-P4","battery_code":"AFI-LIIO-18650-JPBKI","legacy_cell_id":"278"},
    {"position":"S6-P5","battery_code":"AFI-LIIO-18650-T86AO","legacy_cell_id":"449"},
    {"position":"S6-P6","battery_code":"AFI-LIIO-18650-M2PBI","legacy_cell_id":"281"},
    {"position":"S6-P7","battery_code":"AFI-LIIO-18650-C7UBH","legacy_cell_id":"440"},
    {"position":"S6-P8","battery_code":"AFI-LIIO-18650-I10J3","legacy_cell_id":"473"},
    {"position":"S6-P9","battery_code":"AFI-LIIO-18650-XPKYN","legacy_cell_id":"28"},
    {"position":"S6-P10","battery_code":"AFI-LIIO-18650-KX39C","legacy_cell_id":"31"},
    {"position":"S6-P11","battery_code":"AFI-UNK-UNK-VG3QM","legacy_cell_id":"218"},
]

base = "https://afterlife-int-production.up.railway.app"
for item in cells:
    code = item["battery_code"]
    r = httpx.get(f"{base}/passport/", params={"search": code, "page_size": 5}, timeout=15)
    payload = r.json()
    matches = payload.get("passports", [])
    match = next((m for m in matches if str(m.get("battery_code", "")).upper() == code.upper()), None)
    if match is None and matches:
        match = matches[0]
    grade = (match or {}).get("current_grade") or (match or {}).get("grade") or "Ungraded"
    soh = (match or {}).get("soh_percent")
    cap_nom = (match or {}).get("nominal_capacity_ah")
    dcir = (match or {}).get("dcir_mohm")
    measured = (float(soh) / 100.0) * float(cap_nom) if soh is not None and cap_nom is not None else None
    print(f"{item['position']}|{grade}|SOH={soh}|MeasuredCap={measured}|DCIR={dcir}|Legacy={item['legacy_cell_id']}|Code={code}|Nominal={cap_nom}")
