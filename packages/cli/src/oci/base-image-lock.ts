export const OCI_BUN_BASE_IMAGE = Object.freeze({
  digest: "sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f",
  image: "oven/bun",
  platforms: ["linux/amd64", "linux/arm64"] as const,
  variant: "debian",
  version: "1.3.14"
});

export const OCI_BUN_BASE_REFERENCE =
  `${OCI_BUN_BASE_IMAGE.image}:${OCI_BUN_BASE_IMAGE.version}-${OCI_BUN_BASE_IMAGE.variant}@${OCI_BUN_BASE_IMAGE.digest}`;
