# BnF Data prototype

Static files:

- `scripts/data/audio-annotations.json` - Audio annotations linking from audio to MusicXML
- `scripts/data/audio-manifest.json` - IIIF Manifest containing the audio
- `scripts/data/image-annotations.json` - Annotations linking IDs in the MusicXML to scanned images
- `scripts/data/image-manifest.json` - IIIF Manifest containing the scanned images
- `scripts/data/score.xml` - The MusicXML file

To run, first we need the dependencies:

```sh
pnpm install
```

Then the script can be run (Node 22+)

```sh
node scripts/generate-manifest.ts
```

The script `generate-manifest.ts` will update the `combined-manifest.json` file, which is a IIIF Manifests that tries to combine all of the sources above.

The structure of that Manifest is as follows:

- A single IIIF Manifest with a single IIIF Canvas
- The Canvas has a duration that matches the length of the Audio
- The Canvas has a painting annotation (under `items`) containing the Audio track
- The Canvas has additional painting annotations for each scanned image, matched to the correct timestamp
- The Canvas has an `annotations` property which holds annotations that target both time and regions on the canvas - highlighting notes

The Manifest can be viewed inside of Theseus or IIIF Canvas Panel framework:

- [Theseus Viewer](https://theseusviewer.org/?iiif-content=https%3A%2F%2Fgist.githubusercontent.com%2Fstephenwf%2F5092325557d706b5be0eb8bb76afebe1%2Fraw%2F20568c55e9361e96dc913c64a1312b15d5cdeb5d%2Fmanifest.json)
- [React IIIF Vault](https://react-iiif-vault-demo.netlify.app/#manifest=https%3A%2F%2Fgist.githubusercontent.com%2Fstephenwf%2F5092325557d706b5be0eb8bb76afebe1%2Fraw%2F20568c55e9361e96dc913c64a1312b15d5cdeb5d%2Fmanifest.json)

There are some limitations in this proof of concept due to the time constraints of the data modelling. Most issues could be fixed with
a better analysis of the data and making logical links between the MusicXML and the IIIF.

- **Browser support** - due to this being a complex use-case without many examples created, this has been tested and developed in Chrome-based browsers.
- **Scrubbing** - At the moment the audio files are sent to the browser without appropriate headers that would allow for scrubbing, so this feature does not work in the examples currently. It only supports playback from the start to the end. This is enforced by the browser. The audio lacks CORS headers which also limits how the audio can be loaded and manipulated.
- **Audio mismatch** - I don't know for certain, but I don't think the audio matches the digitised images.
- **Missing annotations** - due to the limitations of the script we can't find both time and spatial co-ordinates for annotations.

The script loops through all of the annotations from both files provided and maps their spatial coordinates (the SVGs) and the temporal selectors to the MusicXML identifiers. A final list is compiled where both a temporal and spatial selector is found. Many of the annotations do not have both components and only around 100 elements are displayed in the prototype. These seem to be individual notes at the start of each bar.

The data processing is simplistic due to the time constraints, but it should demonstrate the idea of displaying the data in a multi-dimensional way.
