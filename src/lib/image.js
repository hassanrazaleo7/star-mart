// Resizes a picture in the browser before upload so the 1 MB server limit is never a surprise.
export async function resizeToJpeg(file, { max = 900, quality = 0.82, limit = 1_000_000 } = {}) {
  let image;
  try {
    image = await createImageBitmap(file instanceof Blob ? file : new Blob([file]));
  } catch {
    throw Error('Could not read this picture. Use a JPG, PNG or WebP file.');
  }
  try {
    const scale = Math.min(1, max / Math.max(image.width, image.height)),
      canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw Error('Could not process this picture.');
    if (blob.size > limit) throw Error('Image is too large after resizing');
    return blob;
  } finally {
    image.close();
  }
}
