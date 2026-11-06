// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { entryBlob, fileReader, readZipDirectory, ZipError } from './zip';
import { makeZip } from './zip-fixture';

const text = async (b: Blob) => new TextDecoder().decode(await b.arrayBuffer());

async function open(bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart]);
  return { blob, entries: await readZipDirectory(fileReader(blob), blob.size) };
}

describe('takeout zip reader', () => {
  it.each([false, true])('lists entries and reads stored and deflated bytes (zip64 %s)', async (zip64) => {
    const json = JSON.stringify({ title: 'IMG_0001.jpg', photoTakenTime: { timestamp: '1563096600' } });
    const { blob, entries } = await open(makeZip([
      { name: 'Takeout/Google Photos/Photos from 2019/', data: '' },
      { name: 'Takeout/Google Photos/Photos from 2019/IMG_0001.jpg', data: 'JPEGBYTES' },
      { name: 'Takeout/Google Photos/Photos from 2019/IMG_0001.jpg.supplemental-metadata.json', data: json, deflate: true },
      { name: 'Takeout/Drive/Résumé.docx', data: 'DOCX' },
    ], { zip64 }));
    expect(entries.map((e) => [e.name, e.isDir, e.size])).toEqual([
      ['Takeout/Google Photos/Photos from 2019/', true, 0],
      ['Takeout/Google Photos/Photos from 2019/IMG_0001.jpg', false, 9],
      ['Takeout/Google Photos/Photos from 2019/IMG_0001.jpg.supplemental-metadata.json', false, json.length],
      ['Takeout/Drive/Résumé.docx', false, 4],
    ]);
    expect(entries[2].method).toBe(8);
    expect(await text(await entryBlob(blob, entries[1]))).toBe('JPEGBYTES');
    expect(await text(await entryBlob(blob, entries[2]))).toBe(json);
    expect(await text(await entryBlob(blob, entries[3]))).toBe('DOCX');
  });

  it('refuses a file that is not a zip, or a zip cut short by an unfinished download', async () => {
    const notZip = new Blob(['hello, this is not a zip archive at all']);
    await expect(readZipDirectory(fileReader(notZip), notZip.size)).rejects.toMatchObject({ code: 'not-zip' });
    const whole = makeZip([{ name: 'a.txt', data: 'abc' }]);
    const cut = new Blob([whole.slice(0, whole.length - 10) as BlobPart]);
    await expect(readZipDirectory(fileReader(cut), cut.size)).rejects.toBeInstanceOf(ZipError);
  });
});
