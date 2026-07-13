# wordgen

CLI that picks the 18 words of the day for "18 слов" / "18 Words" / "18 คำ"
and writes them to `<out>/<date>.json`, so the web client can just fetch a
static file instead of picking words in the browser.

## Usage

```sh
cd backend
go run . -date=2026-07-10 -lang=ru                  # writes ./2026-07-10.json
go run . -date=2026-07-10 -lang=ru -out=../ru/days  # writes ../ru/days/2026-07-10.json
go run . -date=2026-07-10 -lang=en -out=../en/days
go run . -date=2026-07-10 -lang=th -out=../th/days
```

Flags:

- `-date` — YYYY-MM-DD, defaults to today (UTC).
- `-lang` — language code, defaults to `ru`. Must match a
  `data/words-<lang>.json` dictionary.
- `-dict` — path to the dictionary JSON, defaults to `data/words-<lang>.json`.
- `-out` — output directory, defaults to `.`.

## Dictionary format (`data/words-<lang>.json`)

```json
{
  "language": "ru",
  "words": {
    "4": ["слово", "..."],
    "5": ["...", "..."],
    "6": ["...", "..."]
  }
}
```

Each key is a word length; the client currently needs at least 4, 5 and 6
letter words, 3000 of each is comfortable headroom (with 6 words picked per
length per day, the daily rotation only repeats every 3000/6 = 500 days).

Each entry is either just the word (`"biff"`) or the word followed by a space
and its definition (`"biff a sharp blow or punch (informal)"`). The client
splits on the first space; a word with no definition yet is simply left as-is
and the client shows no meaning for it. The word's length (used to bucket it
by key and to size its game tile row) is always just the part before the
space, so appending a definition never changes which bucket a word belongs
in.

## Selection algorithm

Same idea as the client used to run in-browser: the day number since
2024-01-01 picks a rotating window out of a per-length shuffle seeded by the
word length, so the same date always produces the same words and the whole
dictionary cycles through before repeating.

## Output format (`<out>/<date>.json`)

```json
{
  "date": "2026-07-10",
  "language": "ru",
  "lengths": [4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6],
  "words": ["...", "... 18 words total"]
}
```

Entries carry the same optional `"word definition"` format as the source
dictionary (it's just copied straight through by the selection algorithm).

## Regenerating the bundled dictionaries

`data/words-ru.json` and `data/words-th.json` were built from public word
lists (frequency-ranked subtitle vocabulary for Russian, a segmentation
dictionary for Thai), filtered to Cyrillic/Thai-only tokens, deduplicated,
and passed through a small profanity blocklist. `data/words-en.json` was
built from the `wamerican` system dictionary, filtered to lowercase
alphabetic-only entries (no proper nouns or contractions), ranked by
`wordfreq` frequency to keep only common words, and passed through the same
profanity blocklist. There's no in-repo script for this yet — regenerate by
hand if you need to refresh them.
