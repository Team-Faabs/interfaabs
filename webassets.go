package webassets

import "embed"

// Dist contains the compiled frontend bundle embedded into the Go binary.
//go:embed all:frontend/dist
var Dist embed.FS
