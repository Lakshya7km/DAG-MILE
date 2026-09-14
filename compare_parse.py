import json
import urllib.request
import urllib.error
import uuid

SAMPLE = r"D:\DAG_MILE_PROJECT\sample_dataset.csv"
with open(SAMPLE, "rb") as f:
    raw = f.read()
print("sample bytes:", len(raw), "first line:", raw.splitlines()[0].decode())


def multipart(files, fields=None):
    boundary = "----dagmile" + uuid.uuid4().hex
    body = b""
    fields = fields or {}
    for k, v in fields.items():
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"
        ).encode()
    for name, filename, data in files:
        body += (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
            f"Content-Type: text/csv\r\n\r\n"
        ).encode() + data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def req(method, url, data=None, headers=None, json_body=None):
    h = dict(headers or {})
    payload = data
    if json_body is not None:
        payload = json.dumps(json_body).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=payload, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            ct = resp.headers.get("content-type", "")
            b = resp.read()
            return resp.status, ct, json.loads(b) if "json" in ct else b.decode(errors="replace")[:2000]
    except urllib.error.HTTPError as e:
        b = e.read().decode(errors="replace")
        try:
            parsed = json.loads(b)
        except Exception:
            parsed = b[:2000]
        return e.code, e.headers.get("content-type", ""), parsed


print("\n===== ORIGINAL FastAPI :8001 GET / =====")
st, ct, body = req("GET", "http://127.0.0.1:8001/")
print(st, ct, str(body)[:150].replace("\n", " "))

print("\n===== CURRENT Python :8000 GET / =====")
print(req("GET", "http://127.0.0.1:8000/"))

print("\n===== ORIGINAL upload+analyze+suggest+preprocess =====")
body, ctype = multipart([("files", "sample_dataset.csv", raw)])
st, ct, up = req("POST", "http://127.0.0.1:8001/api/upload", data=body, headers={"Content-Type": ctype})
print("upload", st, json.dumps(up, indent=2) if isinstance(up, dict) else up)
sid = up.get("session_id") if isinstance(up, dict) else None
st, ct, an = req("GET", f"http://127.0.0.1:8001/api/analyze/{sid}")
if isinstance(an, dict) and "profiles" in an:
    prof = an["profiles"]["sample_dataset.csv"]
    print("shape", prof.get("shape"), "missing", prof.get("missing_cells"), "dups", prof.get("duplicate_rows"))
    print("columns:")
    for c in prof.get("columns", []):
        print(" ", c.get("name"), c.get("dtype"), "missing_pct", c.get("missing_pct"))
else:
    print("analyze", st, an)

st, ct, sug = req("GET", f"http://127.0.0.1:8001/api/preprocess-suggestions/{sid}/sample_dataset.csv")
print("suggestions", st)
if isinstance(sug, dict):
    print(" drop_duplicates", sug.get("drop_duplicates"))
    for name, plan in (sug.get("columns") or {}).items():
        print(" ", name, plan)

st, ct, pre = req(
    "POST",
    f"http://127.0.0.1:8001/api/preprocess/{sid}/sample_dataset.csv",
    json_body={"drop_duplicates": True, "columns": sug.get("columns") if isinstance(sug, dict) else {}},
)
print("preprocess", st)
if isinstance(pre, dict):
    print(" shape after", pre.get("shape"))
    for line in pre.get("log") or []:
        print(" ", line)

print("\n===== NODE :4000 without token =====")
body, ctype = multipart([("files", "sample_dataset.csv", raw)])
print("upload", req("POST", "http://127.0.0.1:4000/api/upload", data=body, headers={"Content-Type": ctype})[0:3])

print("\n===== NODE register/login then upload =====")
email = f"cmp_{uuid.uuid4().hex[:8]}@test.local"
print("register", req("POST", "http://127.0.0.1:4000/api/v1/register", json_body={"email": email, "password": "password123"})[0])
st, ct, login = req("POST", "http://127.0.0.1:4000/api/v1/login", json_body={"email": email, "password": "password123"})
print("login", st, login.get("message") if isinstance(login, dict) else login)
token = login.get("accessToken") if isinstance(login, dict) else None
auth = {"Authorization": f"Bearer {token}"}
body, ctype = multipart([("files", "sample_dataset.csv", raw)])
st, ct, up2 = req("POST", "http://127.0.0.1:4000/api/upload", data=body, headers={**auth, "Content-Type": ctype})
print("node upload", st, json.dumps(up2, indent=2) if isinstance(up2, dict) else up2)
sid2 = up2.get("session_id") if isinstance(up2, dict) else None
if sid2:
    st, ct, an2 = req("GET", f"http://127.0.0.1:4000/api/analyze/{sid2}", headers=auth)
    print("node analyze", st)
    if isinstance(an2, dict) and "profiles" in an2:
        prof = an2["profiles"]["sample_dataset.csv"]
        print(" shape", prof.get("shape"), "missing", prof.get("missing_cells"), "dups", prof.get("duplicate_rows"))
    else:
        print(an2)
    st, ct, sug2 = req(
        "GET",
        f"http://127.0.0.1:4000/api/preprocess-suggestions/{sid2}/sample_dataset.csv",
        headers=auth,
    )
    print("node suggestions", st, list(sug2.keys()) if isinstance(sug2, dict) else sug2)
    st, ct, pre2 = req(
        "POST",
        f"http://127.0.0.1:4000/api/preprocess/{sid2}/sample_dataset.csv",
        headers=auth,
        json_body={"drop_duplicates": True, "columns": sug2.get("columns") if isinstance(sug2, dict) else {}},
    )
    print("node preprocess", st)
    if isinstance(pre2, dict):
        print(" shape after", pre2.get("shape"), "log", pre2.get("log") or pre2.get("error") or pre2.get("detail") or pre2)
    else:
        print(pre2)
else:
    print("no session; cannot analyze")
