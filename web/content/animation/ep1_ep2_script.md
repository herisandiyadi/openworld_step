# Episode 1 & 2 — Tim Kendaraan Konstruksi (Toddler & Kids)

Data-driven script for the animated episodes.
Dialogue language: **English** (spoken track). Indonesian version lives in Notion §4.
Pacing rules enforced here: max 5 words per line, JD 1.5–2 s after every line,
+1 s extra after a question, speech rate −30% from normal (~2.5–3 syllables/s).

`cam` = camera preset. `beat` = one stage action, no dialogue.

```json
{
  "fps": 30,
  "jd": 2.0,
  "jdLong": 3.0,
  "characters": {
    "buldo":  { "name": "Buldo",  "kind": "bulldozer", "color": "#F5C518", "accent": "#B8860B", "voice": "en-US-AndrewNeural", "trait": "strong and patient" },
    "eksa":   { "name": "Eksa",   "kind": "excavator", "color": "#F07818", "accent": "#B45309", "voice": "en-US-EmmaNeural",   "trait": "friendly and busy" },
    "truk":   { "name": "Truk",   "kind": "dumptruck", "color": "#2E86DE", "accent": "#1B5390", "voice": "en-US-BrianNeural",  "trait": "happy and eager" },
    "kreni":  { "name": "Kreni",  "kind": "crane",     "color": "#E74C3C", "accent": "#A93226", "voice": "en-US-AvaNeural",    "trait": "tall and careful" },
    "molen":  { "name": "Molen",  "kind": "mixer",     "color": "#ECF0F1", "accent": "#95A5A6", "voice": "en-GB-MaisieNeural", "trait": "playful and patient" },
    "giling": { "name": "Giling", "kind": "roller",    "color": "#27AE60", "accent": "#1E8449", "voice": "en-US-GuyNeural",    "trait": "calm and neat" }
  }
}
```

## Episode 1 — "Let's Meet First!" (~1:40)

### 1.1 Opening [0:00–0:12] — no dialogue
- beat: all six vehicles lined up, slow blink, gentle music.

### 1.2 Greeting A
- buldo: "Hi! I am Buldo." → JD 2s
- buldo: "I am strong!" → JD 2s
- eksa: "Hi! I am Eksa." → JD 2s
- eksa: "I dig!" → JD 2s

### 1.3 Greeting B
- truk: "Hi! I am Truk." → JD 2s
- truk: "I carry sand!" → JD 2s
- kreni: "Hi! I am Kreni." → JD 2s
- kreni: "I am tall!" → JD 2s

### 1.4 Greeting C
- molen: "Hi! I am Molen." → JD 2s
- molen: "Round and round!" → JD 2s
- giling: "Hi! I am Giling." → JD 2s
- giling: "I make it flat!" → JD 2s

### 1.5 Closing chant [chant, slower]
- all: "Buldo, Eksa, Truk!" → JD 2s
- all: "Kreni, Molen, Giling!" → JD 3s
- all: "We are all friends!" → JD 3s, fade out

## Episode 2 — "Let's Get to Work!" (~1:30)

### 2.1 Small problem
- beat: messy dirt field (holes and piles).
- buldo: "Ground is not flat." → JD 2s
- buldo: "Let us go, Buldo helps!" → JD 2s

### 2.2 Buldo works
- beat: Buldo pushes dirt slowly.
- sfx: "Bruuush..."
- buldo: "The ground is flat!" → JD 2s

### 2.3 Eksa digs
- eksa: "Now, I dig." → JD 2s
- beat: Eksa digs slowly, once, twice.
- eksa: "One. Two." → JD 2s
- eksa: "The hole is ready!" → JD 2s

### 2.4 Truk carries
- truk: "Sand, let us go up!" → JD 2s
- beat: truck loaded with sand, drives slowly.
- truk: "Vroom vroom... go!" → JD 2s
- truk: "The sand is here!" → JD 2s

### 2.5 Closing
- all: "Working together is fun!" → JD 3s
- beat: all wave buckets/rollers, fade out.

## Stage rules (from Notion §5)
- Camera static or very slow pan/tilt. No handheld shake, no whip pan.
- Vehicle motion at ~50% of realistic speed.
- Blink every ~3 s while idle; smile on success.
- Action beat: 8–12 s with no dialogue. Dialogue beat: 4–6 s.
- Background contrast with the character colour (light brown dirt for yellow Buldo).
