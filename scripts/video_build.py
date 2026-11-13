"""VIDEO-1: build a narrated demo video of the live product, server-side.

  python3 scripts/video_build.py --check          # guard every narration line (runs in checks)
  python3 scripts/video_build.py --build OUT_DIR  # screenshots + neural TTS + ffmpeg -> demo.mp4, demo.srt

Build needs: playwright (chromium), piper-tts with a voice model in $PIPER_VOICE, ffmpeg.
Installed by .github/workflows/demo-video.yml on the Actions runner; nothing runs on a person's computer.
"""
import json, pathlib, subprocess, sys, wave

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import social_lib  # noqa: E402

SB = ROOT / "video" / "storyboard.json"
LENIENT = ("lacks a required on-topic term", "too long for")


def check(sb=None):
    sb = sb or json.loads(SB.read_text())
    bad = []
    for i, s in enumerate(sb["scenes"]):
        for v in social_lib.guard(s["text"], s["source"]):
            # Narration is spoken over a page, not posted alone: length and per-line topic do not apply.
            if not v.startswith(LENIENT):
                bad.append(f"scene {i} ({s['path']}): {v}")
    if not any(k in " ".join(s["text"].lower() for s in sb["scenes"]) for k in ("ultrastable",)):
        bad.append("script never names Ultrastable")
    if not sb["scenes"]:
        bad.append("no scenes")
    return bad


def ts(sec):
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def build(out):
    import os
    from playwright.sync_api import sync_playwright
    sb = json.loads(SB.read_text())
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    w, h = sb["viewport"]
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
        for i, s in enumerate(sb["scenes"]):
            pg.goto(sb["base_url"] + s["path"], wait_until="networkidle", timeout=45000)
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(out / f"s{i}.png"))
        b.close()
    from piper import PiperVoice
    voice = PiperVoice.load(os.environ["PIPER_VOICE"])
    srt, clips, t = [], [], 0.0
    for i, s in enumerate(sb["scenes"]):
        wav = out / f"s{i}.wav"
        with wave.open(str(wav), "wb") as wf:
            voice.synthesize_wav(s["text"], wf)
        with wave.open(str(wav)) as wf:
            dur = wf.getnframes() / wf.getframerate() + 0.9
        frames = int(dur * 30)
        clip = out / f"s{i}.mp4"
        # Slow Ken Burns push-in over the real page; audio padded to the scene length.
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(out / f"s{i}.png"), "-i", str(wav),
                        "-filter_complex",
                        f"[0:v]scale={w*2}:{h*2},zoompan=z='min(zoom+0.0006,1.08)':d={frames}:s={w}x{h}:fps=30,"
                        f"fade=t=in:st=0:d=0.4,fade=t=out:st={dur-0.4:.2f}:d=0.4,format=yuv420p[v];[1:a]apad[a]",
                        "-map", "[v]", "-map", "[a]", "-t", f"{dur:.2f}", "-c:v", "libx264", "-preset", "medium",
                        "-crf", "20", "-c:a", "aac", "-b:a", "128k", str(clip)], check=True)
        clips.append(clip)
        srt.append(f"{i+1}\n{ts(t + 0.2)} --> {ts(t + dur - 0.3)}\n{s['text']}\n")
        t += dur
    (out / "demo.srt").write_text("\n".join(srt))
    (out / "list.txt").write_text("".join(f"file '{c.name}'\n" for c in clips))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(out / "list.txt"),
                    "-vf", f"subtitles={out / 'demo.srt'}:force_style='FontName=DejaVu Sans,FontSize=9,BorderStyle=3,Outline=2,BackColour=&H99000000,MarginV=14'",
                    "-c:v", "libx264", "-crf", "20", "-c:a", "copy", str(out / "demo.mp4")], check=True)
    meta = {"id": sb["id"], "seconds": round(t, 1), "scenes": len(clips)}
    (out / "demo.json").write_text(json.dumps(meta))
    return meta


if __name__ == "__main__":
    if sys.argv[1:2] == ["--build"]:
        print(json.dumps(build(sys.argv[2])))
    else:
        errs = check()
        print("\n".join(errs) or f"video storyboard ok ({len(json.loads(SB.read_text())['scenes'])} scenes)")
        sys.exit(1 if errs else 0)
