import datetime, pathlib, sys, json
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import funding_packet as fp

T = datetime.date(2026, 11, 10)
IDS = {"B-GSTART"}

def mk(tmp, pk, applicant=None):
    d = pathlib.Path(tmp) / "x"; d.mkdir(exist_ok=True)
    (d / "packet.json").write_text(json.dumps(pk))
    if applicant: (d / "applicant.json").write_text(json.dumps(applicant))
    return d / "packet.json"

def base():
    return {"registry_id": "B-GSTART", "program": "p", "status": "drafted", "form_url": "u", "verified_on": "2026-11-10",
            "prerequisites": [{"id": "entity", "met": False}], "answers": {"q": "fine"}, "submit_steps": ["s"],
            "default_in_effect": "d", "closing_probe": "c", "banned_terms": ["patent"]}

def test_all(tmp_path=None):
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        s, u, f = fp.evaluate(mk(t, base()), base(), IDS, T)
        assert s == "drafted" and u == ["entity"] and any(x["kind"] == "prerequisites-unmet" for x in f)
        b = base(); b["answers"]["q"] = "a Patent"; assert any(x["kind"] == "banned-term" for x in fp.evaluate(mk(t, b), b, IDS, T)[2])
        b = base(); b["registry_id"] = "nope"; assert any(x["kind"] == "unknown-registry-id" for x in fp.evaluate(mk(t, b), b, IDS, T)[2])
        s, u, f = fp.evaluate(mk(t, base()), base(), IDS, T + datetime.timedelta(days=40)); assert any(x["kind"] == "stale" for x in f)
        s, u, f = fp.evaluate(mk(t, base(), {"entity_name": "E", "email": "e@x"}), base(), IDS, T)
        assert s == "ready" and not f
    print("ok")

if __name__ == "__main__":
    test_all()
