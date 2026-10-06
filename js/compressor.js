export async function compressFileToGzip(file) {
  if (!("CompressionStream" in window)) {
    throw new Error(
      "This browser does not support gzip compression. Use a current version of Chrome, Edge, Firefox, or Safari."
    );
  }

  const compressedStream = file.stream().pipeThrough(new CompressionStream("gzip"));
  const compressedBlob = await new Response(compressedStream).blob();

  return new File(
    [compressedBlob],
    file.name.endsWith(".gz") ? file.name : `${file.name}.gz`,
    { type: "application/gzip", lastModified: file.lastModified }
  );
}
