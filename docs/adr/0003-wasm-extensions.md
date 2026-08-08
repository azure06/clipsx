# ADR 0003: extension isolation

Status: Accepted

Community extensions run as sandboxed WASM. They receive explicit inputs and
return structured render, detection, or transformation models; they do not get
direct filesystem, network, clipboard, database, shell, environment, or React
access.
