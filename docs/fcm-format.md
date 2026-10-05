<!-- FCM 파일 포맷 스펙 (보존용). 출처: github.com/markuryy/open-fcm docs/format.md, MIT License. 원본은 위 저장소 참조. -->

# FCM File Format

FCM files are the native format for Brother ScanNCut cutting machines. They contain vector paths, metadata, and a thumbnail image.

## Variants

There are two file variants:

- **FCM** — Standard cut files. Paths are cut directly from material on the mat.
- **VCM** — Print-and-cut files. The design is printed first, then the machine scans registration marks to align cuts with the printed artwork.

The variant is determined by the file header, not the extension.

## Units

All coordinates and dimensions in FCM files are stored as **hundredths of a millimeter** (integers). For example:

- 1mm = 100 units
- 1 inch = 2540 units
- A4 width (210mm) = 21000 units

The `Point` type uses `x` and `y` as integers in these units.

## File Structure

An FCM file has three main sections:

```
┌─────────────────────┐
│    File Header      │  Variant, version, names, thumbnail, generator
├─────────────────────┤
│     Cut Data        │  Page size, file type, alignment marks (if VCM)
├─────────────────────┤
│    Piece Table      │  Collection of cuttable pieces
└─────────────────────┘
```

### File Header

Contains metadata about the file:

| Field | Description |
|-------|-------------|
| `variant` | `"FCM"` or `"VCM"` |
| `version` | Usually `"0100"` |
| `content_id` | Numeric identifier |
| `short_name` | 8-character name |
| `long_name` | Full name (UTF-16) |
| `author_name` | Creator name |
| `copyright` | Copyright string |
| `thumbnail` | 88×88 monochrome BMP (1118 bytes) |
| `generator` | What created the file (App, Web, or Device) |
| `print_to_cut` | Whether this is a print-and-cut file |

The thumbnail is critical based on testing — invalid BMP data can cause the machine to reboot when the file is on external media.

### Cut Data

Defines the working area and cut settings:

| Field | Description |
|-------|-------------|
| `file_type` | `"Cut"` or `"PrintAndCut"` |
| `mat_id` | Mat type identifier |
| `cut_width` | Page width in FCM units |
| `cut_height` | Page height in FCM units |
| `seam_allowance_width` | For sewing patterns |
| `alignment` | Registration mark data (VCM only) |

For print-and-cut files, `alignment` contains:
- `needed` — Whether the machine should scan for marks
- `marks` — Array of 4 corner positions (top-left, top-right, bottom-right, bottom-left)

### Piece Table

Contains the actual cut data as a collection of **pieces**. Each piece is an independent design element that can be manipulated (moved, scaled, rotated) on the machine.

## Piece Structure

A piece represents a single cuttable unit:

| Field | Description |
|-------|-------------|
| `width` / `height` | Bounding box dimensions |
| `transform` | 2D affine transform `[a, b, c, d, tx, ty]` positioning the piece on the page |
| `restriction_flags` | What operations are allowed (flip, rotate, scale, etc.) |
| `label` | 3-character label |
| `paths` | Array of path objects |

The transform places the piece's local coordinates onto the page. Paths within the piece are defined relative to the piece center (0, 0).

## Path Structure

Each path defines a single cut operation:

| Field | Description |
|-------|-------------|
| `tool` | Bitflags for cut/draw/emboss/etc. |
| `shape` | The actual geometry (start point + outlines) |
| `rhinestone_diameter` | For rhinestone paths |
| `rhinestones` | Array of rhinestone positions |

### Tool Flags

Paths specify which tool operations apply:

```typescript
PathTool.PATH_OPEN        // 0x0001 - Open path (not closed)
PathTool.TOOL_CUT         // 0x0002 - Cut with blade
PathTool.TOOL_DRAW        // 0x0004 - Draw with pen
PathTool.SEAM_ALLOWANCE   // 0x0008 - Add seam allowance
PathTool.TOOL_RHINESTONE  // 0x0010 - Rhinestone placement
PathTool.FILL             // 0x0020 - Fill pattern
PathTool.AUTO_ALIGN       // 0x0040 - Auto-align to material
PathTool.TOOL_DRAW_ONLY   // 0x1000 - Draw only (no cut)
PathTool.TOOL_EMBOSS      // 0x2000 - Emboss
PathTool.TOOL_FOIL        // 0x4000 - Foil transfer
PathTool.TOOL_PERFORATING // 0x8000 - Perforating blade
```

### Shape and Outlines

A shape consists of:
- `start` — Starting point
- `outlines` — Array of outline segments

Each outline is either:
- **Line** — Array of `{ end: Point }` segments
- **Bezier** — Array of `{ control1, control2, end }` cubic bezier segments

Outlines are drawn sequentially from the start point, with each segment's end becoming the next segment's start.

## Example: Simple Square

A 10mm × 10mm square centered at (50mm, 50mm):

```typescript
const fcm = {
  file_header: {
    variant: "FCM",
    version: "0100",
    content_id: 0,
    short_name: "",
    long_name: "Square",
    author_name: "",
    copyright: "",
    thumbnail_block_size_width: 3,
    thumbnail_block_size_height: 3,
    thumbnail: generateBlankThumbnail(),
    generator: { type: "App", version: 1 },
    print_to_cut: null,
  },
  cut_data: {
    file_type: "Cut",
    mat_id: 0,
    cut_width: 30480,  // 12 inches
    cut_height: 30480,
    seam_allowance_width: 0,
    alignment: null,
  },
  piece_table: {
    pieces: [{
      id: 0,
      piece: {
        width: 1000,   // 10mm
        height: 1000,
        transform: [1, 0, 0, 1, 5000, 5000],  // Center at 50mm, 50mm
        expansion_limit_value: 0,
        reduction_limit_value: 0,
        restriction_flags: 0,
        label: "",
        paths: [{
          tool: PathTool.TOOL_CUT,
          shape: {
            start: { x: -500, y: -500 },  // Relative to piece center
            outlines: [{
              type: "Line",
              segments: [
                { end: { x: 500, y: -500 } },
                { end: { x: 500, y: 500 } },
                { end: { x: -500, y: 500 } },
                { end: { x: -500, y: -500 } },  // Close the path
              ],
            }],
          },
          rhinestone_diameter: null,
          rhinestones: [],
        }],
      },
    }],
  },
};
```

## See Also

- [Parsing API](./api/parsing.md) — Reading and writing FCM files
- [Print-and-Cut Guide](./guides/print-and-cut.md) — Working with registration marks
