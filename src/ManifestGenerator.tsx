import React, { useState, useEffect } from 'react';
import { Vault } from "@iiif/helpers";
import { createPaintingAnnotationsHelper } from "@iiif/helpers/painting-annotations";
import { getId, getImageServices } from "@iiif/parser/image-3";

interface ManifestGeneratorProps {}

interface FormData {
  audioManifestUrl: string;
  imageManifestUrl: string;
  audioAnnotationsUrl: string;
  imageAnnotationsUrl: string;
  selectedCanvasIndex: number;
}

const ManifestGenerator: React.FC<ManifestGeneratorProps> = () => {
  const [formData, setFormData] = useState<FormData>({
    audioManifestUrl: 'https://openapi.bnf.fr/iiif/presentation/v3/ark:/12148/bpt6k88448791/manifest.json',
    imageManifestUrl: 'https://gallica.bnf.fr/iiif/ark:/12148/bpt6k11620688/manifest.json',
    audioAnnotationsUrl: 'https://neuma.huma-num.fr/rest/collections/all:collabscore:saintsaens-audio:C055_0/_annotations/time-frame/_all/',
    imageAnnotationsUrl: 'https://neuma.huma-num.fr/rest/collections/all:collabscore:saintsaens-audio:C055_0/_annotations/image-region/note-region/',
    selectedCanvasIndex: 2
  });

  const [isLoading, setIsLoading] = useState(false);
  const [generatedManifest, setGeneratedManifest] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [audioCanvases, setAudioCanvases] = useState<Array<{id: string, label: string, index: number, duration?: number, hasAudio?: boolean}>>([]);
  const [isLoadingCanvases, setIsLoadingCanvases] = useState(false);
  const [selectedCanvasInfo, setSelectedCanvasInfo] = useState<string>('');

  const handleInputChange = (field: keyof FormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Update canvas info when selection changes
    if (field === 'selectedCanvasIndex' && typeof value === 'number') {
      updateSelectedCanvasInfo(audioCanvases, value);
    }
  };

  const fetchJson = async (url: string): Promise<any> => {
    // Try direct fetch first
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
      }
      return response.json();
    } catch (directError) {
      throw new Error(`Failed to fetch ${url}. Direct error: ${directError}`);
    }
  };

  const loadAudioCanvases = async () => {
    if (!formData.audioManifestUrl) {
      setError('Please enter an audio manifest URL first');
      return;
    }

    setIsLoadingCanvases(true);
    setError('');

    try {
      const audioManifest = await fetchJson(formData.audioManifestUrl);

      if (!audioManifest.items || !Array.isArray(audioManifest.items)) {
        throw new Error('Invalid audio manifest: no items array found');
      }

      const canvases = audioManifest.items.map((canvas: any, index: number) => {
        let label = 'Unnamed Canvas';

        if (canvas.label) {
          if (typeof canvas.label === 'string') {
            label = canvas.label;
          } else if (canvas.label.en && Array.isArray(canvas.label.en)) {
            label = canvas.label.en[0] || label;
          } else if (canvas.label.en) {
            label = canvas.label.en;
          }
        }

        // Add duration info if available
        if (canvas.duration) {
          label += ` (${Math.round(canvas.duration)}s)`;
        }

        // Check if canvas has audio content
        const hasAudio = canvas.items && canvas.items.some((annoPage: any) =>
          annoPage.items && annoPage.items.some((anno: any) =>
            anno.body && (anno.body.type === 'Sound' || anno.body.format?.includes('audio'))
          )
        );

        return {
          id: canvas.id,
          label: hasAudio ? label : label + ' (⚠️ No audio)',
          index,
          duration: canvas.duration,
          hasAudio
        };
      });

      setAudioCanvases(canvases);

      // If current selection is out of range, reset to first canvas
      if (formData.selectedCanvasIndex >= canvases.length) {
        handleInputChange('selectedCanvasIndex', 0);
      }

      // Update selected canvas info
      updateSelectedCanvasInfo(canvases, formData.selectedCanvasIndex);

    } catch (err) {
      setError(`Failed to load audio canvases: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoadingCanvases(false);
    }
  };

  const updateSelectedCanvasInfo = (canvases: typeof audioCanvases, index: number) => {
    const canvas = canvases[index];
    if (canvas) {
      let info = `Canvas ${index}: ${canvas.label}`;
      if (canvas.duration) {
        info += ` | Duration: ${Math.round(canvas.duration)}s`;
      }
      if (canvas.hasAudio === false) {
        info += ' | ⚠️ This canvas may not contain audio content';
      }
      setSelectedCanvasInfo(info);
    } else {
      setSelectedCanvasInfo('');
    }
  };

  // Auto-load canvases when audio manifest URL changes
  useEffect(() => {
    if (formData.audioManifestUrl && formData.audioManifestUrl.startsWith('http')) {
      const timeoutId = setTimeout(() => {
        loadAudioCanvases();
      }, 500); // Debounce to avoid too many requests while typing

      return () => clearTimeout(timeoutId);
    }
  }, [formData.audioManifestUrl]);

  const TEMPORAL_SELECTOR = /&?(t=)(npt:)?([0-9]+(\.[0-9]+)?)?(,([0-9]+(\.[0-9]+)?))?/;

  const getTime = (frag: string): { start: number; end: number } => {
    const match = frag.match(TEMPORAL_SELECTOR);
    if (match) {
      const start = parseFloat(match[3]);
      const end = parseFloat(match[6]);
      return { start, end };
    }
    return { start: 0, end: 0 };
  };

  const toSvg = (width: number, height: number, points: number[][], el = "polygon") => {
    return {
      type: "SvgSelector",
      value: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><${el} points="${points.map((p: any) => p.join(",")).join(" ")}" /></svg>`,
    };
  };

  const parseFragmentSelector = (value: string) => {
    const coords = value
      .replace(/^\(\(|\)\)$/g, "")
      .split(/\)\(/)
      .map((coord) => coord.replace("P", "").split(",").map(Number));
    return coords;
  };

  const orderCanvasMapping = (canvasMinMax: Record<string, { min: number; max: number }>) => {
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
        const start = current.originalMin;
        let end: number;

        if (next) {
          end = (current.originalMax + next.originalMin) / 2;
        } else {
          end = current.originalMax;
        }

        result.push({ id: current.id, start, end });
      } else {
        const start = result[i - 1].end;
        let end: number;

        if (next) {
          end = (current.originalMax + next.originalMin) / 2;
        } else {
          end = current.originalMax;
        }

        result.push({ id: current.id, start, end });
      }
    }

    return result;
  };

  const orderAnnotationMapping = (annotation: any) => {
    const entries = Object.entries(annotation)
      .filter(([, range]: [string, any]) => !!range.audio && range.svgSelector)
      .map(([id, range]: [string, any]) => ({
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
        const start = current.originalMin;
        let end: number;

        if (next) {
          end = (current.originalMax + next.originalMin) / 2;
        } else {
          end = current.originalMax;
        }

        result.push({ id: current.id, start, end });
      } else {
        const start = result[i - 1].end;
        let end: number;

        if (next) {
          end = (current.originalMax + next.originalMin) / 2;
        } else {
          end = current.originalMax;
        }

        result.push({ id: current.id, start, end });
      }
    }

    return result;
  };

  const fixAudio = (audio: any) => {
    audio.body.format = "audio/mpeg";
    audio.body.type = "Sound";
    return audio;
  };

  const generateManifest = async () => {
    setIsLoading(true);
    setError('');
    setGeneratedManifest('');

    try {
      // Validate URLs first
      const urls = [
        formData.audioAnnotationsUrl,
        formData.imageAnnotationsUrl,
        formData.imageManifestUrl,
        formData.audioManifestUrl
      ];

      for (const url of urls) {
        if (!url || !url.startsWith('http')) {
          throw new Error(`Invalid URL: ${url}`);
        }
      }

      // Fetch all required data
      const [audioAnnotations, imageAnnotations, imageManifest, audioManifest] = await Promise.all([
        fetchJson(formData.audioAnnotationsUrl),
        fetchJson(formData.imageAnnotationsUrl),
        fetchJson(formData.imageManifestUrl),
        fetchJson(formData.audioManifestUrl)
      ]);

      const vault = new Vault();
      const imageManifestNorm = vault.loadManifestSync(imageManifest["@id"], JSON.parse(JSON.stringify(imageManifest)))!;
      vault.loadManifestSync(audioManifest.id, JSON.parse(JSON.stringify(audioManifest)))!;
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

      // Process audio annotations
      Object.entries(audioAnnotations).forEach(([id, annotations]) => {
        const annotationList = Array.isArray(annotations) ? annotations : [annotations];
        for (const anno of annotationList) {
          if (anno?.body?.source && anno?.body?.selector?.type === "FragmentSelector") {
            mapping[id] = mapping[id] || {};
            mapping[id].audio = getTime(anno.body.selector.value);
          }
        }
      });

      const canvasMinMax: Record<string, { min: number; max: number }> = {};

      // Process image annotations
      Object.entries(imageAnnotations).forEach(([id, annotations]) => {
        const annotationList = Array.isArray(annotations) ? annotations : [annotations];
        for (const anno of annotationList) {
          if (anno?.body?.source && anno?.body?.selector?.type === "FragmentSelector") {
            if (!mapping[id] || !mapping[id].audio) return;
            const audio = mapping[id].audio;
            if (!audio) return;

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

      const orderedCanvases = orderCanvasMapping(canvasMinMax);

      // Validate canvas index
      if (formData.selectedCanvasIndex >= audioManifest.items.length) {
        throw new Error(`Selected canvas index ${formData.selectedCanvasIndex} is out of range. Audio manifest has ${audioManifest.items.length} canvases.`);
      }

      const audioCanvas = audioManifest.items[formData.selectedCanvasIndex];
      if (!audioCanvas) {
        throw new Error(`No canvas found at index ${formData.selectedCanvasIndex}`);
      }

      // Validate that selected canvas has audio content
      const hasAudioContent = audioCanvas.items && audioCanvas.items.some((annoPage: any) =>
        annoPage.items && annoPage.items.some((anno: any) =>
          anno.body && (anno.body.type === 'Sound' || anno.body.format?.includes('audio'))
        )
      );

      if (!hasAudioContent) {
        throw new Error(`Selected canvas at index ${formData.selectedCanvasIndex} does not contain audio content. Please select a different canvas.`);
      }

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

      const filteredAnnotationMapping = orderAnnotationMapping(mapping);

      const newManifest = {
        id: "https://example.org",
        type: "Manifest",
        label: { en: ["Combined manifest generated interactively"] },
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

      setGeneratedManifest(JSON.stringify(newManifest, null, 2));
    } catch (err) {
      console.error('Error generating manifest:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.includes('CORS') || errorMessage.includes('Failed to fetch')) {
        setError(`Network error: ${errorMessage}. This might be due to CORS restrictions. Try running the dev server with proxy support or ensure the URLs are accessible.`);
      } else {
        setError(`Error generating manifest: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedManifest);
      // Could add a toast notification here
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      // Fallback: select text
      const textArea = document.createElement('textarea');
      textArea.value = generatedManifest;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const downloadManifest = () => {
    const blob = new Blob([generatedManifest], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'combined-manifest.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="manifest-generator">
      <h1>Interactive IIIF Manifest Generator</h1>
      <p>Generate combined IIIF manifests from audio manifests, image manifests, and their corresponding annotations.</p>

      <div style={{ backgroundColor: '#e8f4fd', padding: '1rem', borderRadius: '6px', marginBottom: '2rem', border: '1px solid #b3d9ff' }}>
        <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e5a8a' }}>How to use:</h3>
        <ol style={{ margin: '0', paddingLeft: '1.5rem', color: '#2c5282' }}>
          <li>Enter the URLs for your audio manifest, image manifest, and annotation resources</li>
          <li>The form is pre-filled with BnF example data - you can modify these URLs</li>
          <li>Click "Generate Manifest" to process the resources and create a combined manifest</li>
          <li>Use the copy or download buttons to save your generated manifest</li>
        </ol>
        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#4a5568' }}>
          <strong>Note:</strong> This tool requires the resources to be CORS-enabled or accessible via the development proxy.
        </p>
      </div>

      <div>
        <h2>Resource URLs</h2>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">
              Audio Manifest URL:
            </label>
            <input
              type="url"
              value={formData.audioManifestUrl}
              onChange={(e) => handleInputChange('audioManifestUrl', e.target.value)}
              className="form-input"
              placeholder="https://openapi.bnf.fr/iiif/..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Image Manifest URL:
            </label>
            <input
              type="url"
              value={formData.imageManifestUrl}
              onChange={(e) => handleInputChange('imageManifestUrl', e.target.value)}
              className="form-input"
              placeholder="https://gallica.bnf.fr/iiif/..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Audio Annotations URL:
            </label>
            <input
              type="url"
              value={formData.audioAnnotationsUrl}
              onChange={(e) => handleInputChange('audioAnnotationsUrl', e.target.value)}
              className="form-input"
              placeholder="https://neuma.huma-num.fr/rest/..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Image Annotations URL:
            </label>
            <input
              type="url"
              value={formData.imageAnnotationsUrl}
              onChange={(e) => handleInputChange('imageAnnotationsUrl', e.target.value)}
              className="form-input"
              placeholder="https://neuma.huma-num.fr/rest/..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Audio Canvas Selection:
            </label>
            <div className="canvas-selection-container">
              <select
                value={formData.selectedCanvasIndex}
                onChange={(e) => handleInputChange('selectedCanvasIndex', parseInt(e.target.value))}
                className="form-input canvas-select"
                disabled={audioCanvases.length === 0}
              >
                {audioCanvases.length === 0 ? (
                  <option value={2}>Canvas 3 (Default)</option>
                ) : (
                  audioCanvases.map((canvas) => (
                    <option key={canvas.index} value={canvas.index}>
                      Canvas {canvas.index}: {canvas.label}
                      {canvas.duration ? ` (${Math.round(canvas.duration)}s)` : ''}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={loadAudioCanvases}
                disabled={isLoadingCanvases || !formData.audioManifestUrl}
                className="load-canvases-button"
              >
                {isLoadingCanvases ? 'Loading...' : 'Load Canvases'}
              </button>
            </div>
            <small className="help-text">
              Canvases are loaded automatically when you enter an audio manifest URL, or click "Load Canvases" to refresh.
            </small>
            {selectedCanvasInfo && (
              <div className="canvas-info">
                <strong>Selected:</strong> {selectedCanvasInfo}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={generateManifest}
          disabled={isLoading}
          className="generate-button"
        >
          {isLoading && <span className="loading-spinner"></span>}
          {isLoading ? 'Generating...' : 'Generate Manifest'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {generatedManifest && (
        <div className="success-section">
          <div className="success-header">
            <h2>Generated Manifest</h2>
            <button
              onClick={copyToClipboard}
              className="action-button copy-button"
            >
              📋 Copy to Clipboard
            </button>
            <button
              onClick={downloadManifest}
              className="action-button download-button"
            >
              💾 Download JSON
            </button>
          </div>
          <pre className="manifest-output">
            {generatedManifest}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ManifestGenerator;
