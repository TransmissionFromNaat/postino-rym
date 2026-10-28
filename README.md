# Postino for RateYourMusic

**Postino** is a userscript that takes a release from **Discogs** or **Bandcamp** and fills in the **RateYourMusic "Add Release" form** for you, following the RYM rules.

It never submits anything by itself: you check the form, press Preview and submit. You always have the last word.

---

## What it fills in

- **Release type**: album, EP, single, compilation, DJ mix, mixtape… When Discogs gives no clear info, the panel says the type is an estimate.
- **Date, title, format and disc size**
- **Catalog number** (`n/a` when there is no label or no number, as RYM asks)
- **Country**, with the official RYM names (Russia → Russian Federation, Czech Republic → Czechia…)
- **Issue attributes**: colored vinyl, 180 gram, 33 rpm, gatefold, digipak, limited, numbered, remastered, box set…
- **Performance attributes**: live, remixes, instrumental, demo, archival, soundtrack… (RYM thresholds: more than 50% of the tracks)
- **Tracklist**:
  - RYM positions (`CD.1` → `1`, `1-1` → `1.1`, `AA` → `B`, `A01` → `A1`)
  - lines without a number for suites, works and sections, in bold (`[b]…[/b]`)
  - a `CD` / `DVD` line before each medium
  - untitled tracks as `[untitled]`
  - "(Original Mix)" removed
  - on Various Artists releases: `Artist - Title`
- **Capitalization**: RYM rules for English titles, first letter only for other languages. The language is detected title by title, and you can switch it with a checkbox.
- **Source**: the Discogs or Bandcamp link

It also tells you what is left to do in a short **To do** list: pick the label from the search results, set the primary issue for reissues, check the estimated type…

## Install

1. Install **Tampermonkey** (free) on Chrome or Firefox, Mac or Windows.
2. **Chrome only**: go to *Extensions → Tampermonkey → Details* and turn on **"Allow user scripts"**.
3. Install the script:
   - open [`postino.en.user.js`](postino.en.user.js), click **Raw**, and Tampermonkey will offer to install it, **or**
   - click the Tampermonkey icon → *Create a new script*, paste the file and save.

An Italian version is also available: [`postino.it.user.js`](postino.it.user.js).

## How to use

1. Open a release on **Discogs** or an album on **Bandcamp**.
2. Press the red **→ RYM** button (bottom right). A notice confirms that the data is saved.
3. Open the **Add Release** page of the artist on RYM. If it is already open, the panel updates by itself.
4. Press **Fill form** in the panel.
5. Read the **To do** list, check everything, then press **Preview** and submit.

Two checkboxes in the panel:

- **English capitalization**: untick it for non-English titles (first letter only).
- **Import track times** (vinyl only): RYM wants track times on vinyl only if they are printed on the record.

## Known limits

- **Split releases** are not fully supported yet (RYM has no API). For now it works best with releases by a single artist.
- **Proper names** in non-English titles cannot be detected: check them by hand.
- **Estimates**: the release type and some attributes are estimated when Discogs gives no clear info. The panel always tells you when.
- **Bandcamp**: only `*.bandcamp.com` pages are supported, not artists with their own domain.

## Privacy

The script only reads the release from the Discogs API or from the Bandcamp page. The data is saved in Tampermonkey on your computer, and only used to fill in the RYM form. Nothing is sent anywhere else.

## Feedback

Bug reports and ideas are welcome. Please open an issue with the link to the Discogs or Bandcamp release.
