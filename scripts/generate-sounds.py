"""Generate the original WHATZ IT party-game sound pack."""

import math
import random
import wave
from pathlib import Path

RATE = 44_100
OUT = Path(__file__).resolve().parents[1] / "assets" / "sounds"
random.seed(20260712)


def render(name, seconds, voices, gain=0.82):
    frames = []
    for i in range(int(RATE * seconds)):
        t = i / RATE
        sample = sum(voice(t) for voice in voices)
        sample = math.tanh(sample * 1.35) * gain
        frames.append(int(max(-1, min(1, sample)) * 32767))
    with wave.open(str(OUT / name), "wb") as output:
        output.setparams((1, 2, RATE, len(frames), "NONE", "not compressed"))
        output.writeframes(b"".join(value.to_bytes(2, "little", signed=True) for value in frames))


def pop(at, pitch=150, length=0.13, amount=1.0):
    def voice(t):
        x = t - at
        if x < 0 or x > length:
            return 0
        envelope = math.exp(-x * 30) * (1 - math.exp(-x * 220))
        tone = math.sin(2 * math.pi * (pitch * x + 130 * x * math.exp(-x * 24)))
        click = (random.random() * 2 - 1) * math.exp(-x * 90)
        return amount * envelope * (tone * 0.72 + click * 0.28)
    return voice


def woodblock(at, pitch=920, amount=0.7):
    def voice(t):
        x = t - at
        if x < 0 or x > 0.12:
            return 0
        envelope = math.exp(-x * 38) * (1 - math.exp(-x * 500))
        return amount * envelope * (math.sin(2 * math.pi * pitch * x) + 0.38 * math.sin(2 * math.pi * pitch * 1.71 * x))
    return voice


def chime(at, pitch=660, length=0.55, amount=0.45):
    def voice(t):
        x = t - at
        if x < 0 or x > length:
            return 0
        envelope = math.exp(-x * 5.8) * (1 - math.exp(-x * 320))
        return amount * envelope * (math.sin(2 * math.pi * pitch * x) + 0.35 * math.sin(2 * math.pi * pitch * 2.01 * x))
    return voice


def swoosh(at, length=0.24, rising=True, amount=0.38):
    last = [0.0]
    def voice(t):
        x = t - at
        if x < 0 or x > length:
            return 0
        envelope = max(0, math.sin(math.pi * x / length)) ** 1.4
        noise = random.random() * 2 - 1
        smooth = last[0] * 0.78 + noise * 0.22
        last[0] = smooth
        sweep = x / length if rising else 1 - x / length
        return amount * envelope * smooth * (0.35 + sweep * 0.65)
    return voice


def buzzer(at, length=0.26, amount=0.38):
    def voice(t):
        x = t - at
        if x < 0 or x > length:
            return 0
        envelope = (1 - x / length) ** 1.5 * (1 - math.exp(-x * 160))
        wobble = 105 + 18 * math.sin(2 * math.pi * 17 * x)
        return amount * envelope * (1 if math.sin(2 * math.pi * wobble * x) >= 0 else -1)
    return voice


OUT.mkdir(parents=True, exist_ok=True)
render("get-ready.wav", 1.05, [swoosh(0.0, 0.34), pop(0.25, 145), woodblock(0.56, 760), woodblock(0.76, 940), pop(0.88, 190)])
render("count-3.wav", 0.24, [pop(0, 125, 0.18), woodblock(0.015, 690, 0.48)])
render("count-2.wav", 0.24, [pop(0, 145, 0.18), woodblock(0.015, 790, 0.48)])
render("count-1.wav", 0.27, [pop(0, 170, 0.2), woodblock(0.015, 920, 0.52)])
render("round-start.wav", 0.58, [swoosh(0, 0.3), pop(0.18, 205, 0.2, 1.15), chime(0.2, 784, 0.34, 0.45), chime(0.26, 1047, 0.3, 0.38)])
render("final-tick.wav", 0.16, [woodblock(0, 1120, 0.66), pop(0, 185, 0.11, 0.38)], gain=0.74)
render("correct.wav", 0.56, [pop(0, 190, 0.2, 1.0), chime(0.06, 784, 0.4, 0.42), chime(0.13, 1175, 0.38, 0.38)])
render("pass.wav", 0.48, [swoosh(0, 0.3, False, 0.5), buzzer(0.16, 0.25, 0.28), pop(0.28, 115, 0.16, 0.55)])
render("round-end.wav", 1.42, [buzzer(0, 0.24, 0.25), pop(0.19, 170, 0.2), chime(0.28, 659, 0.65), chime(0.44, 784, 0.7), chime(0.62, 1047, 0.72), pop(0.82, 220, 0.18, 0.8)])
