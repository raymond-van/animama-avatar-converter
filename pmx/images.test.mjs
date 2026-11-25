import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ImageFormatError, alphaUsage, createImage, decodeBmp, decodeDds, decodePng, decodeTga, detectImageKind, encodePng } from "./images.mjs";
import { deflateSync } from "node:zlib";
import { bmp24 } from "./testing/synthetic.mjs";
import { resolveTexturePath } from "./textures.mjs";

const pixel = (image, x, y) => Array.from(image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

test("decodes a bottom-up 24-bit BMP", () => {
  const image = decodeBmp(bmp24());
  assert.equal(image.width, 4);
  assert.equal(image.height, 2);
  assert.deepEqual(pixel(image, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(image, 3, 0), [255, 255, 255, 255]);
  assert.deepEqual(pixel(image, 0, 1), [40, 50, 60, 255]);
});

test("PNG encoding round-trips RGBA pixels", () => {
  const image = createImage(5, 3);
  for (let i = 0; i < image.pixels.length; i++) image.pixels[i] = (i * 37) & 0xff;
  const png = encodePng(image);
  assert.equal(detectImageKind(png, "x.bin"), "png");
  assert.deepEqual(Array.from(decodePng(png).pixels), Array.from(image.pixels));
});

test("decodes a run-length, top-down 32-bit TGA", () => {
  const header = Buffer.alloc(18);
  header[2] = 10; // RLE true colour
  header.writeUInt16LE(2, 12);
  header.writeUInt16LE(2, 14);
  header[16] = 32;
  header[17] = 0x28; // top-left origin, 8 alpha bits
  // A run of three (BGRA 10,20,30,128), then one raw pixel.
  const data = Buffer.from([0x82, 10, 20, 30, 128, 0x00, 1, 2, 3, 255]);
  const image = decodeTga(new Uint8Array(Buffer.concat([header, data])));
  assert.deepEqual(pixel(image, 0, 0), [30, 20, 10, 128]);
  assert.deepEqual(pixel(image, 1, 1), [3, 2, 1, 255]);
});

test("decodes a DXT1 DDS block", () => {
  const dds = Buffer.alloc(128 + 8);
  dds.write("DDS ", 0, "latin1");
  dds.writeInt32LE(4, 12);
  dds.writeInt32LE(4, 16);
  dds.writeUInt32LE(0x4, 80);
  dds.write("DXT1", 84, "latin1");
  dds.writeUInt16LE(0xf800, 128); // red
  dds.writeUInt16LE(0x001f, 130); // blue
  dds.writeUInt32LE(0x55555555, 132); // every pixel index 1
  const image = decodeDds(new Uint8Array(dds));
  assert.deepEqual(pixel(image, 2, 3), [0, 0, 255, 255]);
});

test("classifies alpha as opaque, cutout or blend", () => {
  const image = createImage(10, 10);
  image.pixels.fill(255);
  assert.equal(alphaUsage(image), "opaque");
  for (let i = 0; i < 30; i++) image.pixels[i * 4 + 3] = 0;
  assert.equal(alphaUsage(image), "cutout");
  for (let i = 0; i < 30; i++) image.pixels[i * 4 + 3] = 120;
  assert.equal(alphaUsage(image), "blend");
});

test("resolves texture paths ignoring case and either separator", async () => {
  const dir = realpathSync(await mkdtemp(path.join(os.tmpdir(), "pmx-textures-")));
  await mkdir(path.join(dir, "Tex", "Sub"), { recursive: true });
  await writeFile(path.join(dir, "Tex", "Sub", "Face.PNG"), "x");
  assert.equal(resolveTexturePath(dir, "tex\\sub\\face.png"), path.join(dir, "Tex", "Sub", "Face.PNG"));
  assert.equal(resolveTexturePath(dir, "./TEX/Sub/face.png"), path.join(dir, "Tex", "Sub", "Face.PNG"));
  assert.equal(resolveTexturePath(dir, "tex\\missing.png"), null);
  assert.equal(resolveTexturePath(dir, ""), null);
});

test("never leaves the model's folder for a texture", async () => {
  const root = realpathSync(await mkdtemp(path.join(os.tmpdir(), "pmx-contain-")));
  const model = path.join(root, "pack", "model");
  await mkdir(path.join(model, "tex"), { recursive: true });
  await writeFile(path.join(model, "face.png"), "x");
  await writeFile(path.join(root, "pack", "shared.png"), "x");
  await writeFile(path.join(root, "secret.png"), "x");
  // Absolute, drive and UNC paths: only their file name, looked up in the model's folder.
  assert.equal(resolveTexturePath(model, path.join(root, "secret.png")), null);
  assert.equal(resolveTexturePath(model, "C:\\Users\\x\\face.png"), path.join(model, "face.png"));
  assert.equal(resolveTexturePath(model, "\\\\evil.example\\share\\face.png"), path.join(model, "face.png"));
  assert.equal(resolveTexturePath(model, "/etc/face.png"), path.join(model, "face.png"));
  // One folder up is allowed, two are not.
  assert.equal(resolveTexturePath(model, "..\\shared.png"), path.join(root, "pack", "shared.png"));
  assert.equal(resolveTexturePath(model, "../../secret.png"), null);
  assert.equal(resolveTexturePath(model, "tex/../../../secret.png"), null);
  // A link inside the folder that leads out of it is refused.
  await symlink(path.join(root, "secret.png"), path.join(model, "tex", "link.png"));
  assert.equal(resolveTexturePath(model, "tex/link.png"), null);
});

test("refuses image headers that would allocate more than the data holds", () => {
  const bmp = Buffer.alloc(70);
  bmp.write("BM", 0, "latin1");
  bmp.writeInt32LE(54, 10);
  bmp.writeInt32LE(40, 14);
  bmp.writeInt32LE(8000, 18);
  bmp.writeInt32LE(8000, 22);
  bmp.writeInt16LE(8, 28);
  bmp.writeInt32LE(0x7fffffff, 46); // colours used
  assert.throws(() => decodeBmp(new Uint8Array(bmp)), ImageFormatError);
  const tga = Buffer.alloc(20);
  tga[2] = 2;
  tga.writeUInt16LE(8000, 12);
  tga.writeUInt16LE(8000, 14);
  tga[16] = 32;
  assert.throws(() => decodeTga(new Uint8Array(tga)), ImageFormatError);
  assert.throws(() => createImage(9000, 9000), ImageFormatError);
});

test("refuses PNG data that inflates beyond its declared size", () => {
  const small = encodePng(createImage(2, 2));
  // Swap the IDAT for one that inflates to far more than two rows of two pixels.
  const bomb = deflateSync(Buffer.alloc(1 << 20));
  const start = small.indexOf("IDAT") - 4;
  const length = small.readUInt32BE(start);
  const chunk = Buffer.alloc(12 + bomb.length);
  chunk.writeUInt32BE(bomb.length, 0);
  chunk.write("IDAT", 4, "latin1");
  bomb.copy(chunk, 8);
  const png = Buffer.concat([small.subarray(0, start), chunk, small.subarray(start + 12 + length)]);
  assert.throws(() => decodePng(new Uint8Array(png)), ImageFormatError);
});

test("resolves textures when the model's folder is reached through a link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pmx-linked-"));
  await mkdir(path.join(root, "real"), { recursive: true });
  await writeFile(path.join(root, "real", "face.png"), "x");
  await symlink(path.join(root, "real"), path.join(root, "linked"));
  assert.ok(resolveTexturePath(path.join(root, "linked"), "face.png")?.endsWith("face.png"));
});

test("refuses BMP and TGA headers with impossible depths or offsets", () => {
  const bmp = Buffer.from(bmp24());
  bmp.writeInt16LE(-5, 28);
  assert.throws(() => decodeBmp(new Uint8Array(bmp)), /bits per pixel/);
  const offset = Buffer.from(bmp24());
  offset.writeInt32LE(-100, 10);
  assert.throws(() => decodeBmp(new Uint8Array(offset)), /corrupt/);
  const tga = Buffer.alloc(18);
  tga[2] = 3;
  tga.writeUInt16LE(8000, 12);
  tga.writeUInt16LE(8000, 14);
  assert.throws(() => decodeTga(new Uint8Array(tga)), /bits per pixel/);
});
