# vectordb — knowledge-base storage for Edge AI Studio

FastAPI worker behind the **Vector Database** service: knowledge bases, file
upload and chunking, text and vector search, used by the RAG chatbot and other
samples. Knowledge-base metadata lives in `data/database.db` (sqlite); the
vectors live in one of two interchangeable storage backends.

| Backend | Selected by | Where vectors live | Needs |
|---|---|---|---|
| `faiss` (default) | `--db-backend faiss` | `data/<kb-id>/faissdb` | nothing |
| `pgvector` | `--db-backend pgvector` | PostgreSQL + [pgvector](https://github.com/pgvector/pgvector), one collection per knowledge base | `git` at first start (see below) |

The HTTP API is identical for both. In the app the backend is chosen in the
service's **Configure** panel (or `metadata.vectorDbBackend` in
`deployment.json`); switching it restarts the worker. Existing knowledge bases
are **not** migrated between backends: a knowledge base created on FAISS is
empty when viewed through pgvector and vice versa.

## pgvector backend

```bash
./start.sh --port 8017 --db-backend pgvector                       # embedded PostgreSQL
./start.sh --port 8017 --db-backend pgvector \
    --pg-connection-string postgresql://user:pass@host:5432/db     # your own PostgreSQL
curl http://127.0.0.1:8017/v1/config                               # shows the active backend
```

- **Embedded PostgreSQL** (default): the [`pgserver`](https://pypi.org/project/pgserver/)
  wheel bundles PostgreSQL 16 with the pgvector extension for Linux, Windows and
  macOS. The cluster is created under `data/pgdata` on first start and stopped
  with the worker. No package install, no container, no root.
- **External PostgreSQL**: pass `--pg-connection-string` (or set
  `metadata.pgConnectionString`). The role must be allowed to
  `CREATE EXTENSION vector`, or the extension must already exist in the database.
  `postgres://`, `postgresql://` and `postgresql+psycopg://` URLs are accepted.

### Reuse of the OEP document-ingestion microservice

The pgvector backend does not re-implement ingestion. It reuses the
[document-ingestion/pgvector](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/microservices/document-ingestion/pgvector)
microservice from `open-edge-platform/edge-ai-libraries`, used natively as a
Python module (its `app.document.ingest_to_pgvector`): pdfplumber/python-docx
parsing, token-based chunking, batched embedding through the configured
embeddings service and storage in the `langchain_pg_*` tables. The schema is
therefore the one every other OEP pgvector consumer expects.

The upstream source is **not vendored**. `start.sh` / `start.ps1` clone it on
demand when the pgvector backend is selected by calling
`oep_fetch services/vectordb` (`workers/oep-setup.sh fetch services/vectordb`).
That script reads `workers/oep-services.json`, the catalogue of OEP
microservices Edge AI Studio uses together with the pinned release `tag`, and
copies `microservices/document-ingestion/pgvector` at that tag into
`thirdparty/document-ingestion` (gitignored) out of the one sparse clone of
`edge-ai-libraries` it keeps under `workers/thirdparty/`:

```
workers/thirdparty/edge-ai-libraries/            the cache: one sparse clone at the pinned tag
workers/services/vectordb/thirdparty/
└── document-ingestion/                          copy of microservices/document-ingestion/pgvector
    ├── .demo-studio-edge-ai-libraries-ref       the tag the copy was made from
    └── app/                                     the package this worker imports
```

This is the same shape as `workers/services/speech-to-text/oep`; there is no
`overlay/` because nothing in the copy needs replacing. `tag` in
`workers/oep-services.json` is the single place the release tag lives: bump
it (`workers/oep-setup.sh pin <tag>`) and restart the worker (the start
script remakes the copy when it is at a different tag). Nothing in the copy
is modified; `utils/oep_upstream.py` supplies the environment its
settings need, serves its structlog logger from the stdlib, and builds its
embeddings client with `check_embedding_ctx_length=False` so chunks go
straight to the embeddings service instead of being tokenised locally first
(which would need `transformers` and a Hugging Face download of the model's
tokenizer). If the worker starts without the start script, it clones on
demand (`OEP_DOCUMENT_INGESTION_AUTO_CLONE=0` disables that);
`OEP_DOCUMENT_INGESTION_HOME` points it at a directory that already holds the
microservice (e.g. `microservices/document-ingestion/pgvector` of a local
`edge-ai-libraries` checkout) instead, which is then used as is.

What comes from upstream and what does not:

| Operation | pgvector backend |
|---|---|
| Embed `.pdf` / `.docx` / `.txt` | upstream `ingest_to_pgvector` (token-based `cl100k_base` splitter, so `chunk_size` / `chunk_overlap` are tokens here) |
| Embed `.html` / `.csv` / `.json` / other formats | this worker's LangChain loaders + the requested splitter, stored through `langchain_postgres` |
| Add chunk, add vectors, search, list, delete | `langchain_postgres.PGVector` and plain SQL on the upstream tables |

The upstream splitter downloads the `cl100k_base` tokenizer once (cached in
`data/upstream-store/tiktoken`).

## FAISS backend

Unchanged from before: one `faissdb` index per knowledge base under
`data/<kb-id>/`, loaded and saved on every write.

## Ingestion progress

Embedding a large PDF or a whole knowledge base takes minutes.
`POST /v1/kb/{id}/files/embed` and `POST /v1/kb/{id}/create` answer with one
JSON body as always, or, when the request sends `Accept: text/event-stream`
(or `?stream=true`), with Server-Sent Events as the work goes
(`worker_common.sse`; keep-alive comments fill quiet stretches, so the app's
instance proxy never times the call out):

```bash
curl -N -X POST http://127.0.0.1:8017/v1/kb/1/files/embed \
    -H 'Accept: text/event-stream' -H 'Content-Type: application/json' \
    -d '{"filename": "handbook.pdf"}'
```

| Event | Data | When |
|---|---|---|
| `queued` | `{ahead}` | other operations on this knowledge base run first |
| `file_start` | `{file, index, files}` | `/create` only: a file begins (`index` is 1-based) |
| `loading` | `{file}` | the file is being parsed |
| `splitting` | `{file, chunks, documents?}` | the file is split into `chunks` |
| `embedding` | `{file, batch, batches, done, total}` | before the first batch (`batch` 0), then after each |
| `storing` | `{file, chunks}` | the vectors are being written |
| `file_done` | `{file, index, files, chunks_created}` | `/create` only: a file is stored |
| `done` | the JSON body the call answers without streaming | last event on success |
| `error` | `{detail, status_code}` | last event on failure |

During `/create` every stage event also carries `index` and `files`.
Request errors (unknown knowledge base or file, `chunk_overlap >= chunk_size`,
unknown splitter, embeddings not configured) are plain HTTP errors, sent
before any event.

Files are embedded 32 chunks per request to the embeddings service
(`EMBED_BATCH_SIZE` in `utils/backends/base.py`) and stored in one write.
Files the pgvector backend hands to the upstream pipeline are embedded and
stored in its own batches (`BATCH_SIZE`, 32 by default), so they report
`embedding` per stored batch and no `storing` stage; `utils/oep_upstream.py`
counts chunks and batches through subclasses of the names `app.document`
imports, without modifying the upstream copy.

Operations on one knowledge base run one at a time, in order, on that
knowledge base's worker thread (`rag_engine._submit_kb_operation`); a request
waits on the operation's `Future`.

## Layout

```
main.py                    HTTP API, argument parsing, KB registry (sqlite)
utils/rag_engine.py        embedding/reranker config, per-KB operation queue, search
utils/backends/base.py     VectorStoreBackend contract
utils/backends/faiss_backend.py
utils/backends/pgvector_backend.py
utils/oep_upstream.py      locate / fetch / import the pinned upstream copy
utils/embedded_postgres.py pgserver lifecycle
utils/loaders.py           file loaders and splitters shared by both backends
thirdparty/                the upstream copy (gitignored), made by workers/oep-setup.sh
                           from the services/vectordb entry in workers/oep-services.json
```
