import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDocumentTextSizeError,
  getImportFileSizeError,
  MAX_DOCUMENT_TEXT_CHARS,
  MAX_IMPORT_FILE_SIZE_BYTES,
} from './documentLimits';

test('document size limits accept their boundary and reject larger inputs', () => {
  assert.equal(getImportFileSizeError(MAX_IMPORT_FILE_SIZE_BYTES), null);
  assert.match(
    getImportFileSizeError(MAX_IMPORT_FILE_SIZE_BYTES + 1) ?? '',
    /20 Mo/
  );
  assert.equal(getDocumentTextSizeError(MAX_DOCUMENT_TEXT_CHARS), null);
  assert.match(getDocumentTextSizeError(MAX_DOCUMENT_TEXT_CHARS + 1) ?? '', /2 millions/);
});
