# ADR 0005: reconstruction byte contract

Status: Accepted

Text representations use normalized UTF-8. Office/OLE and unknown native
formats use byte-exact binary assets. Clipboard adapters write a format only
when they explicitly support its captured exact native type; they never guess
UTIs, OLE format names, or equivalent native identifiers.
