# Infrastructure

This directory contains the infrastructure for the EUTxO L2 Interoperability project.

## Usage

To start the infrastructure with the simplest topology: only two heads, with two participants each, run:

```bash
docker compose up --profile two-heads
```

![Two-heads topology](./two-heads.png)

To start the infrastructure with the single-path topology: 4 heads in a chain, two participants each, run:

```bash
docker compose up --profile single-path
```

![Single-path topology](./single-path.png)
