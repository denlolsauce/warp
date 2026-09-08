"""Gaussian-splat PLY I/O (binary_little_endian, INRIA layout).

Reads/writes the standard trained-splat PLY: x/y/z, f_dc_*, f_rest_*,
opacity (logit), scale_* (log), rot_*. Filtering preserves all attributes
verbatim — cleanup removes gaussians, it never edits them.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np

_PLY_DTYPES = {"float": np.float32, "double": np.float64, "uchar": np.uint8, "int": np.int32}


@dataclass
class GaussianSplat:
    """All per-gaussian attributes; positions/opacities/scales are derived views."""

    field_names: list[str]
    data: np.ndarray  # structured array

    @property
    def positions(self) -> np.ndarray:
        return np.column_stack([self.data["x"], self.data["y"], self.data["z"]]).astype(np.float64)

    @property
    def opacities(self) -> np.ndarray:
        # Stored as logits; sigmoid → [0, 1].
        return 1.0 / (1.0 + np.exp(-self.data["opacity"].astype(np.float64)))

    @property
    def scales(self) -> np.ndarray:
        # Stored as log-scales; exp → metres.
        cols = [n for n in ("scale_0", "scale_1", "scale_2") if n in self.field_names]
        return np.exp(np.column_stack([self.data[c] for c in cols]).astype(np.float64))

    def filtered(self, keep: np.ndarray) -> "GaussianSplat":
        return GaussianSplat(field_names=self.field_names, data=self.data[keep])

    def __len__(self) -> int:
        return len(self.data)


def read_gaussian_ply(path: Path) -> GaussianSplat:
    with path.open("rb") as f:
        header_lines = []
        while True:
            line = f.readline().decode("ascii").strip()
            header_lines.append(line)
            if line == "end_header":
                break

        if header_lines[0] != "ply":
            raise ValueError(f"{path} is not a PLY file")
        fmt = next(line for line in header_lines if line.startswith("format"))
        if "binary_little_endian" not in fmt:
            raise ValueError("only binary_little_endian PLY is supported")

        count = 0
        fields: list[tuple[str, type]] = []
        in_vertex = False
        for line in header_lines:
            if line.startswith("element vertex"):
                count = int(line.split()[-1])
                in_vertex = True
            elif line.startswith("element"):
                in_vertex = False
            elif in_vertex and line.startswith("property"):
                _, dtype_name, name = line.split()
                fields.append((name, _PLY_DTYPES[dtype_name]))

        dtype = np.dtype([(name, np.dtype(t).newbyteorder("<")) for name, t in fields])
        data = np.frombuffer(f.read(count * dtype.itemsize), dtype=dtype, count=count)

    return GaussianSplat(field_names=[name for name, _ in fields], data=data.copy())


def write_gaussian_ply(splat: GaussianSplat, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    dtype_names = {np.dtype(np.float32): "float", np.dtype(np.float64): "double", np.dtype(np.uint8): "uchar", np.dtype(np.int32): "int"}
    header = ["ply", "format binary_little_endian 1.0", f"element vertex {len(splat.data)}"]
    for name in splat.field_names:
        header.append(f"property {dtype_names[splat.data.dtype[name].newbyteorder('=')]} {name}")
    header.append("end_header")
    with path.open("wb") as f:
        f.write(("\n".join(header) + "\n").encode("ascii"))
        f.write(splat.data.tobytes())
