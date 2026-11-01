import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListing,
  compareVersions,
  LISTING,
  listingEntry,
  releaseZip,
} from "./listing.mjs";

const manifest = (version, name = "com.animama.avatar-converter") => ({
  name,
  version,
  displayName: "Animama Avatar Converter",
  unity: "2022.3",
  author: { name: "Animama" },
});

test("a release zip is downloaded from its tag's release", () => {
  assert.deepEqual(
    releaseZip("raymond-van/animama-avatar-converter", "0.1.0"),
    {
      name: "com.animama.avatar-converter-0.1.0.zip",
      url: "https://github.com/raymond-van/animama-avatar-converter/releases/download/v0.1.0/com.animama.avatar-converter-0.1.0.zip",
    },
  );
});

test("the listing holds every released version in order, with its zip and hash", () => {
  const listing = buildListing([
    listingEntry(manifest("0.10.0"), "https://x/10.zip", "10"),
    listingEntry(manifest("0.2.0"), "https://x/2.zip", "2"),
    listingEntry(manifest("0.2.0-rc.1"), "https://x/rc.zip", "rc"),
  ]);

  assert.equal(listing.url, LISTING.url);
  assert.equal(listing.id, "com.animama.vpm");
  const versions = listing.packages["com.animama.avatar-converter"].versions;
  assert.deepEqual(Object.keys(versions), ["0.2.0-rc.1", "0.2.0", "0.10.0"]);
  assert.deepEqual(versions["0.2.0"], {
    ...manifest("0.2.0"),
    url: "https://x/2.zip",
    zipSHA256: "2",
  });
});

test("a duplicated version or another package is refused", () => {
  assert.throws(
    () =>
      buildListing([
        listingEntry(manifest("0.1.0"), "a", "1"),
        listingEntry(manifest("0.1.0"), "b", "2"),
      ]),
    /appears twice/,
  );
  assert.throws(
    () => buildListing([listingEntry(manifest("0.1.0", "other"), "a", "1")]),
    /holds other/,
  );
});

test("versions compare numerically, with pre-releases first", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("1.0.0-rc.1", "1.0.0") < 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
});
