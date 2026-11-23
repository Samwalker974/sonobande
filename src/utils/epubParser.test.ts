import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { parseEpubArrayBuffer } from './epubParser';

test('parseEpubArrayBuffer extracts book title and ordered French chapters from a valid EPUB archive', async () => {
  const zip = new JSZip();

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
     <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
       <rootfiles>
         <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
       </rootfiles>
     </container>`
  );

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
     <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
       <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
         <dc:title>Les Voyages d&rsquo;Été</dc:title>
       </metadata>
       <manifest>
         <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
         <item id="ch2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/>
       </manifest>
       <spine>
         <itemref idref="ch1"/>
         <itemref idref="ch2"/>
       </spine>
     </package>`
  );

  zip.file(
    'OEBPS/Text/ch1.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml">
       <body>
         <h1>Chapitre Premier</h1>
         <p>C&rsquo;&eacute;tait un matin clair sur les quais de la Loire.</p>
       </body>
     </html>`
  );

  zip.file(
    'OEBPS/Text/ch2.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml">
       <body>
         <h2>Deuxième Étape</h2>
         <p>Le train longeait les vignobles sous une lumière dorée.</p>
       </body>
     </html>`
  );

  const epubBytes = await zip.generateAsync({ type: 'uint8array' });
  const extracted = await parseEpubArrayBuffer(epubBytes);

  assert.equal(extracted.title, 'Les Voyages d’Été');
  assert.equal(extracted.chapters.length, 2);
  assert.equal(extracted.chapters[0].title, 'Chapitre Premier');
  assert.ok(extracted.chapters[0].text.includes('C’était un matin clair'));
  assert.equal(extracted.chapters[1].title, 'Deuxième Étape');
  assert.ok(extracted.chapters[1].text.includes('lumière dorée'));
});
