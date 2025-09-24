import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";
import { Vault } from "@iiif/helpers";
import { createPaintingAnnotationsHelper } from "@iiif/helpers/painting-annotations";
import { getId, getImageServices } from "@iiif/parser/image-3";
import { asserts, elements, MusicXML } from "@stringsync/musicxml";

const AUDIO_MANIFEST = "https://openapi.bnf.fr/iiif/presentation/v3/ark:/12148/bpt6k88448791/manifest.json";
const IMAGE_MANIFEST = "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/manifest.json";
const MUSIC_XML = "https://neuma.huma-num.fr/media/corpora/all/collabscore/saintsaens-audio/C055_0/score.xml";
const MUSIC_XML_ANNOTATIONS =
  "https://neuma.huma-num.fr/rest/collections/all:collabscore:saintsaens-audio:C055_0/_annotations/image-region/note-region/";
const AUDIO_ANNOTATIONS =
  "https://neuma.huma-num.fr/rest/collections/all:collabscore:saintsaens-audio:C055_0/_annotations/time-frame/_all/";
const MEI_FILE = "https://neuma.huma-num.fr/media/sources/all-collabscore-saintsaens-audio-C055_0/score.mei";

// MUSIC_XML_ANNOTATIONS - points from IMAGE_MANIFEST to MUSIC_XML
// <note color="#13819E" id="nh_1593_1999">
//   <chord/>
//   <pitch>
//     <step>D</step>
//     <alter>-1</alter>
//     <octave>4</octave>
//   </pitch>
//   <duration>10080</duration>
//   <voice>1</voice>
//   <type>quarter</type>
//   <stem>up</stem>
//   <notehead color="#13819E" parentheses="no">normal</notehead>
//   <staff>1</staff>
// </note>

// AUDIO_ANNOTATIONS - points from audio (start/end) to MUSIX_XML ids

const audioAnnotations = JSON.parse(await readFile(join(cwd(), "scripts/data/audio-annotations.json"), "utf8"));
const imageAnnotations = JSON.parse(await readFile(join(cwd(), "scripts/data/image-annotations.json"), "utf8"));
const imageManifest = JSON.parse(await readFile(join(cwd(), "scripts/data/image-manifest.json"), "utf8"));
const audioManifest = JSON.parse(await readFile(join(cwd(), "scripts/data/audio-manifest.json"), "utf8"));
const scoreXml = MusicXML.parse(await readFile(join(cwd(), "scripts/data/score.xml"), "utf8"));

const vault = new Vault();
const imageManifestNorm = vault.loadManifestSync(imageManifest["@id"], JSON.parse(JSON.stringify(imageManifest)))!;
const audioManifestNorm = vault.loadManifestSync(audioManifest.id, JSON.parse(JSON.stringify(audioManifest)))!;
const paintingHelper = createPaintingAnnotationsHelper(vault);

const manifest = vault.get(imageManifestNorm.id);

const serviceToCanvasId: Record<string, string> = {};
const canvasToServiceId: Record<string, string> = {};
const serviceMap: Record<string, any> = {};
const resourceMap: Record<string, any> = {};

for (const canvasRef of manifest.items) {
  const canvas = vault.get(canvasRef);
  const painting = paintingHelper.getPaintables(canvas);
  const image = painting.items[0]!;
  const service = getImageServices(image.resource as any)[0];
  if (service) {
    const serviceId = getId(service);
    serviceMap[serviceId] = service;
    serviceToCanvasId[serviceId] = canvas.id;
    canvasToServiceId[canvas.id] = serviceId;
    resourceMap[serviceId] = vault.toPresentation3({ id: image.resource.id!, type: "ContentResource" } as any);
  }
}

const mapping: Record<
  string,
  {
    annotations: any[];
    audio: null | { start: number; end: number };
    imageId?: string;
    canvasId?: string;
    svgPoints: number[][];
    svgSelector?: any;
    minMax?: { min: number; max: number };
  }
> = {};

const TEMPORAL_SELECTOR = /&?(t=)(npt:)?([0-9]+(\.[0-9]+)?)?(,([0-9]+(\.[0-9]+)?))?/;

function getTime(frag: string): { start: number; end: number } {
  const match = frag.match(TEMPORAL_SELECTOR);
  if (match) {
    const start = parseFloat(match[3]);
    const end = parseFloat(match[6]);

    return { start, end };
  }
  return { start: 0, end: 0 };
}

function toSvg(width: number, height: number, points: number[][], el = "polygon") {
  return {
    type: "SvgSelector",
    value: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><${el} points="${points.map((p: any) => p.join(",")).join(" ")}" /></svg>`,
  };
}

function parseFragmentSelector(value: string) {
  // Remove outer parentheses and split by coordinate groups
  const coords = value
    .replace(/^\(\(|\)\)$/g, "") // Remove (( at start and )) at end
    .split(/\)\(/) // Split on )(
    .map((coord) => coord.replace("P", "").split(",").map(Number));

  return coords;
}

Object.entries(audioAnnotations).forEach(([id, annotations]) => {
  const annotation = null;
  const audio = {};
  const annotationList = Array.isArray(annotations) ? annotations : [annotations];
  for (const anno of annotationList) {
    // "body": {
    // 	"source": "https://openapi.bnf.fr/iiif/audio/v3/ark:/12148/bpt6k88448791/3.audio",
    // 	"selector": {
    // 		"type": "FragmentSelector",
    // 		"value": "t=0,4.852608",
    // 		"conformsTo": "https://www.w3.org/TR/media-frags/#naming-time"
    // 	}
    // },
    if (anno?.body?.source && anno?.body?.selector?.type === "FragmentSelector") {
      mapping[id] = mapping[id] || {};
      mapping[id].audio = getTime(anno.body.selector.value);
    }
  }
});

// Image annotations. Example:
// {
//   "id": 3260202,
//   "body": {
//     "source": "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/f2",
//     "selector": {
//       "type": "FragmentSelector",
//       "value": "((P1593,1999)(P1593,2030)(P1626,1999)(P1626,2030))",
//       "conformsTo": "http://www.w3.org/TR/SVG/"
//     }
//   },
//   "target": {
//     "source": "/media/sources/all-collabscore-saintsaens-audio-C055_0/score.mei",
//     "selector": {
//       "type": "FragmentSelector",
//       "value": "nh_1593_1999",
//       "conformsTo": "http://tools.ietf.org/rfc/rfc3023"
//     }
//   },
//   "annotation_model": "image-region",
//   "annotation_concept": "note-region"
// }

const canvasMinMax: Record<string, { min: number; max: number }> = {};

Object.entries(imageAnnotations).forEach(([id, annotations]) => {
  const annotation = null;
  const audio = {};
  const annotationList = Array.isArray(annotations) ? annotations : [annotations];
  for (const anno of annotationList) {
    if (anno?.body?.source && anno?.body?.selector?.type === "FragmentSelector") {
      if (!mapping[id] || !mapping[id].audio) return;
      const audio = mapping[id].audio;
      if (!audio) return; // No match?

      mapping[id] = mapping[id] || {};
      mapping[id].imageId = anno.body.source;
      mapping[id].canvasId = serviceToCanvasId[anno.body.source];
      mapping[id].svgPoints = parseFragmentSelector(anno.body.selector.value);

      const canvas = vault.get(serviceToCanvasId[anno.body.source]);
      canvasMinMax[canvas.id] = canvasMinMax[canvas.id] || {
        min: Infinity,
        max: -Infinity,
      };
      canvasMinMax[canvas.id].min = Math.min(audio.start, canvasMinMax[canvas.id].min);
      canvasMinMax[canvas.id].max = Math.max(audio.end, canvasMinMax[canvas.id].max);

      mapping[id].svgSelector = toSvg(canvas.width, canvas.height, mapping[id].svgPoints);
      mapping[id].minMax = canvasMinMax[canvas.id];
    }
  }
});

console.log(mapping);
console.log(canvasMinMax);

// Need to conver this:

// {
//   'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/canvas/f2': { min: 0.37, max: 63.1 },
//   'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/canvas/f3': { min: 64.15, max: 144.38 },
//   'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/canvas/f4': { min: 146.98, max: 196.23 },
//   'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/canvas/f5': { min: 203.39, max: 242.62 }
// }

// Into:
// [
//   { id: 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/canvas/f2', start: 0.37, end: 63.5  },
//   { id: 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/canvas/f3', start: 63.5, end: 145.5  },
//   ...
// ]
// So that it's continuous padding out the space evenly (ordering them first.)
function orderCanvasMapping(canvasMinMax: Record<string, { min: number; max: number }>) {
  // Convert to array and sort by min value
  const entries = Object.entries(canvasMinMax).map(([id, range]) => ({
    id,
    originalMin: range.min,
    originalMax: range.max,
  }));

  entries.sort((a, b) => a.originalMin - b.originalMin);

  if (entries.length === 0) return [];

  const result: { id: string; start: number; end: number }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const next = entries[i + 1];

    if (i === 0) {
      // First canvas starts at its original min
      const start = current.originalMin;
      let end: number;

      if (next) {
        // End halfway between this max and next min
        end = (current.originalMax + next.originalMin) / 2;
      } else {
        // Last canvas, use original max
        end = current.originalMax;
      }

      result.push({
        id: current.id,
        start,
        end,
      });
    } else {
      // Subsequent canvases start where the previous one ended
      const start = result[i - 1].end;
      let end: number;

      if (next) {
        // End halfway between this max and next min
        end = (current.originalMax + next.originalMin) / 2;
      } else {
        // Last canvas, use original max
        end = current.originalMax;
      }

      result.push({
        id: current.id,
        start,
        end,
      });
    }
  }

  return result;
}

// Test the function
const orderedCanvases = orderCanvasMapping(canvasMinMax);

const audioCanvas = audioManifest.items[0];
const canvasId = audioCanvas.id;

const width = Math.max(
  ...orderedCanvases.map((c) => {
    const serviceId = canvasToServiceId[c.id];
    const resource = resourceMap[serviceId];
    return resource.width;
  }),
);
const height = Math.max(
  ...orderedCanvases.map((c) => {
    const serviceId = canvasToServiceId[c.id];
    const resource = resourceMap[serviceId];
    return resource.height;
  }),
);

function fixAudio(audio: any) {
  audio.body.format = "audio/mpeg";
  audio.body.type = "Sound";
  return audio;
}

function orderAnnotationMapping(annotation: typeof mapping) {
  // Convert to array and sort by min value
  const entries = Object.entries(annotation)
    .filter(([id, range]) => !!range.audio && range.svgSelector)
    .map(([id, range]) => ({
      id,
      originalMin: range.audio!.start,
      originalMax: range.audio!.end,
    }));

  entries.sort((a, b) => a.originalMin - b.originalMin);

  if (entries.length === 0) return [];

  const result: { id: string; start: number; end: number }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const next = entries[i + 1];

    if (i === 0) {
      // First canvas starts at its original min
      const start = current.originalMin;
      let end: number;

      if (next) {
        // End halfway between this max and next min
        end = (current.originalMax + next.originalMin) / 2;
      } else {
        // Last canvas, use original max
        end = current.originalMax;
      }

      result.push({
        id: current.id,
        start,
        end,
      });
    } else {
      // Subsequent canvases start where the previous one ended
      const start = result[i - 1].end;
      let end: number;

      if (next) {
        // End halfway between this max and next min
        end = (current.originalMax + next.originalMin) / 2;
      } else {
        // Last canvas, use original max
        end = current.originalMax;
      }

      result.push({
        id: current.id,
        start,
        end,
      });
    }
  }

  return result;
}

const filteredAnnotations = Object.entries(mapping).filter(([key, item]) => {
  return item.svgSelector && item.audio;
});

const filteredAnnotationMapping = orderAnnotationMapping(mapping);

console.log("filteredAnnotationMapping", filteredAnnotationMapping);

//

const newManifest = {
  id: "https://example.org",
  type: "Manifest",
  label: { en: ["Combined manifest 1"] },
  items: [
    {
      id: audioCanvas.id,
      type: "Canvas",
      label: { en: ["Canvas 1"] },
      duration: audioCanvas.duration,
      width,
      height,
      items: [
        {
          id: audioCanvas.items[0].id,
          type: "AnnotationPage",
          items: [
            fixAudio(audioCanvas.items[0].items[0]),
            ...orderedCanvases.map((c, idx) => {
              const serviceId = canvasToServiceId[c.id];
              const resource = resourceMap[serviceId];

              return {
                id: `https://example/image-anno/${idx}`,
                type: "Annotation",
                motivation: "painting",
                body: [resource],
                target: canvasId + `#xywh=0,0,${resource.width},${resource.height}&t=${c.start},${c.end}`,
                //         "format": "image/jpeg",
                // "service": {
                // 	"profile": "http://library.stanford.edu/iiif/image-api/1.1/compliance.html#level2",
                // 	"@context": "http://iiif.io/api/image/1/context.json",
                // 	"@id": "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/f4"
                // },
                // "height": 6174,
                // "width": 4512,
                // "@id": "https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/f4/full/full/0/native.jpg",
              };
            }),
          ],
        },
      ],
      annotations: [
        {
          id: "https://example/image-anno/0",
          type: "AnnotationPage",
          items: filteredAnnotationMapping.map(({ id, start, end }) => {
            const item = mapping[id];
            return {
              id: `https://example/image-anno/${id}`,
              type: "Annotation",
              motivation: "highlighting",
              target: {
                type: "SpecificResource",
                source: audioCanvas.items[0].id,
                selector: [
                  item.svgSelector,
                  {
                    type: "FragmentSelector",
                    conformsTo: "http://www.w3.org/TR/media-frags/",
                    value: `t=${start},${end}`,
                  },
                ],
              },
            };
          }),
        },
      ],
    },
  ],
};

writeFile(join(cwd(), "combined-manifest.json"), JSON.stringify(newManifest, null, 2), "utf8");
