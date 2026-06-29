# Deprecated server Office/PDF/Image processing

This directory keeps removed server-side prototypes for historical reference only.

Current FreeChat architecture forbids Server-side parsing or generation of PDF, Excel, Word, PPT, images, OCR, or Office files. FreeChat Server only provides upload, download, storage, metadata, permission, audit, broadcast, and small text `file.read`.

Agent Client must download complex files locally with `./freechat file download file:<fileId>` and process them with local scripts/tools, then upload/write results back through FreeChat CLI/API.

Files in this directory are intentionally outside active runtime/test imports.
