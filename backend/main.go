// Command wordgen picks the 18 words of the day for the "18 слов" game and
// writes them to <out>/<date>.json.
//
// Usage:
//
//	go run . -date=2026-07-10 -lang=ru
//	go run . -date=2026-07-10 -lang=th -dict=data/words-th.json -out=../th/days
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// roundLengths mirrors ROUND_LENGTHS in the JS client: word length grows
// every 6 words, starting at 4 letters.
var roundLengths = []int{4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6}

type wordDict struct {
	Language string              `json:"language"`
	Words    map[string][]string `json:"words"`
}

type dayFile struct {
	Date     string   `json:"date"`
	Language string   `json:"language"`
	Lengths  []int    `json:"lengths"`
	Words    []string `json:"words"`
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	date := flag.String("date", time.Now().UTC().Format("2006-01-02"), "date to generate words for (YYYY-MM-DD)")
	lang := flag.String("lang", "ru", "language code (must match a data/words-<lang>.json file)")
	dict := flag.String("dict", "", "path to the word dictionary JSON (default: data/words-<lang>.json)")
	out := flag.String("out", ".", "output directory for <date>.json")
	reindex := flag.Bool("reindex", false, "instead of generating a day, scan -out and (re)write its index.json listing every YYYY-MM-DD.json found there")
	flag.Parse()

	if *reindex {
		return writeIndex(*out)
	}

	if _, err := time.Parse("2006-01-02", *date); err != nil {
		return fmt.Errorf("invalid -date %q, expected YYYY-MM-DD: %w", *date, err)
	}

	dictPath := *dict
	if dictPath == "" {
		dictPath = filepath.Join("data", fmt.Sprintf("words-%s.json", *lang))
	}

	d, err := loadDict(dictPath)
	if err != nil {
		return fmt.Errorf("loading dictionary: %w", err)
	}

	words, err := getDailyWords(d, *date)
	if err != nil {
		return fmt.Errorf("selecting daily words: %w", err)
	}

	result := dayFile{
		Date:     *date,
		Language: *lang,
		Lengths:  roundLengths,
		Words:    words,
	}

	if err := os.MkdirAll(*out, 0o755); err != nil {
		return fmt.Errorf("creating output directory: %w", err)
	}
	outPath := filepath.Join(*out, *date+".json")

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding JSON: %w", err)
	}
	if err := os.WriteFile(outPath, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", outPath, err)
	}

	fmt.Printf("wrote %s (%d words, lang=%s)\n", outPath, len(words), *lang)
	return nil
}

var dayFileNameRe = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\.json$`)

// writeIndex scans dir for <YYYY-MM-DD>.json files and writes an index.json
// listing the dates found, sorted ascending. The client fetches this to know
// which past days are available to replay.
func writeIndex(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("reading %s: %w", dir, err)
	}

	var dates []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := dayFileNameRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		dates = append(dates, m[1])
	}
	sort.Strings(dates)

	data, err := json.MarshalIndent(dates, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding index: %w", err)
	}
	outPath := filepath.Join(dir, "index.json")
	if err := os.WriteFile(outPath, append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", outPath, err)
	}

	fmt.Printf("wrote %s (%d dates)\n", outPath, len(dates))
	return nil
}

func loadDict(path string) (*wordDict, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var d wordDict
	if err := json.Unmarshal(raw, &d); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	return &d, nil
}

// ---------- deterministic daily selection (mirrors script.js) ----------

func hashString(s string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}

// mulberry32 returns a seeded PRNG producing floats in [0, 1), matching the
// JS implementation used by the client bit-for-bit (same 32-bit wraparound
// arithmetic).
func mulberry32(seed uint32) func() float64 {
	a := seed
	return func() float64 {
		a += 0x6d2b79f5
		t := a
		t = (t ^ (t >> 15)) * (t | 1)
		t = (t + (t^(t>>7))*(t|61)) ^ t
		return float64(t^(t>>14)) / 4294967296
	}
}

func seededShuffle(arr []string, rng func() float64) []string {
	out := make([]string, len(arr))
	copy(out, arr)
	for i := len(out) - 1; i > 0; i-- {
		j := int(rng() * float64(i+1))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

func dayNumberFor(dateStr string) (int, error) {
	epoch := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return 0, err
	}
	n := int(t.UTC().Sub(epoch).Hours()/24) + 1
	if n < 1 {
		n = 1
	}
	return n, nil
}

func getDailyWords(d *wordDict, dateStr string) ([]string, error) {
	dayIndex, err := dayNumberFor(dateStr)
	if err != nil {
		return nil, err
	}

	counts := map[int]int{}
	for _, l := range roundLengths {
		counts[l]++
	}
	lengths := make([]int, 0, len(counts))
	for l := range counts {
		lengths = append(lengths, l)
	}
	sort.Ints(lengths)

	words := make([]string, 0, len(roundLengths))
	for _, length := range lengths {
		count := counts[length]
		pool := d.Words[strconv.Itoa(length)]
		if len(pool) < count {
			return nil, fmt.Errorf("not enough %d-letter words: have %d, need %d", length, len(pool), count)
		}
		rng := mulberry32(hashString(fmt.Sprintf("len-%d", length)))
		shuffled := seededShuffle(pool, rng)
		start := (dayIndex * count) % len(shuffled)
		for i := 0; i < count; i++ {
			words = append(words, shuffled[(start+i)%len(shuffled)])
		}
	}
	return words, nil
}
