export function validateSlideOrder(assetManifest, expectedCount) {
  if (
    assetManifest.displayOrder?.length !== expectedCount ||
    new Set(assetManifest.displayOrder).size !== expectedCount
  )
    throw new Error('display order must contain unique slide files');
  if (assetManifest.slides?.length !== expectedCount)
    throw new Error('slide asset list has the wrong length');

  const slideFiles = assetManifest.slides.map((slide) => slide.file);
  if (
    slideFiles.some(
      (file, index) =>
        file !== assetManifest.displayOrder[index] ||
        assetManifest.slides[index].number !== index + 1,
    )
  )
    throw new Error('slide asset order does not match display order');
}

export function validatePublicPresentationFiles(files, displayOrder) {
  const actual = files.map((file) => file.replaceAll('\\', '/'));
  const expected = [
    'slides/manifest.json',
    ...displayOrder.map((file) => `slides/${file}`),
  ];
  const expectedSet = new Set(expected);
  const unexpected = actual.find((file) => !expectedSet.has(file));
  if (unexpected)
    throw new Error(`unexpected public presentation asset: ${unexpected}`);

  const actualSet = new Set(actual);
  const missing = expected.find((file) => !actualSet.has(file));
  if (missing) throw new Error(`missing public presentation asset: ${missing}`);

  if (actual.length !== actualSet.size)
    throw new Error('public presentation assets must be unique');
}
