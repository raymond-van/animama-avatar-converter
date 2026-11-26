/**
 * Reading a converted VRM back in tests. The converter writes one mesh per
 * opaque PMX material (blended ones share one), holding the vertices its faces
 * use in PMX order; these helpers map meshes, morph targets and binds back to
 * the PMX through the primitives' materials.
 */

/** @typedef {import("../reader.mjs").PmxModel} PmxModel */

const TYPED = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function viewArray(json, bin, viewIndex, Type, byteOffset, count) {
  const view = json.bufferViews[viewIndex];
  const start = bin.byteOffset + (view.byteOffset ?? 0) + (byteOffset ?? 0);
  return new Type(bin.buffer.slice(start, start + count * Type.BYTES_PER_ELEMENT));
}

/** A dense accessor's values, `size` per element. */
export function accessorValues(json, bin, index) {
  const a = json.accessors[index];
  return viewArray(json, bin, a.bufferView, TYPED[a.componentType], a.byteOffset, a.count * SIZE[a.type]);
}

/** A sparse VEC3 accessor's entries: mesh vertex → [x, y, z]. */
export function sparseEntries(json, bin, index) {
  const { sparse } = json.accessors[index];
  const indices = viewArray(json, bin, sparse.indices.bufferView, TYPED[sparse.indices.componentType], sparse.indices.byteOffset, sparse.count);
  const values = viewArray(json, bin, sparse.values.bufferView, Float32Array, sparse.values.byteOffset, sparse.count * 3);
  return { indices, entries: new Map(Array.from(indices, (v, i) => [v, [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]]])) };
}

/** The PMX vertices of a material's mesh, in the mesh's order (faces only, degenerate ones skipped). */
export function materialVertices(model, material) {
  let start = 0;
  for (let m = 0; m < material; m++) start += model.materials[m].indexCount;
  const used = new Set();
  for (let f = start; f + 2 < start + model.materials[material].indexCount; f += 3) {
    const [a, b, c] = [model.indices[f], model.indices[f + 1], model.indices[f + 2]];
    if (a === b || b === c || a === c) continue;
    used.add(a).add(b).add(c);
  }
  return Uint32Array.from(used).sort();
}

/**
 * Each mesh with its node and the PMX vertices it holds.
 * @param {PmxModel} model
 * @returns {{mesh: number, node: number, name: string, material: number, materials: number[], vertices: Uint32Array}[]}
 */
export function meshes(json, model) {
  return json.meshes.map((mesh, index) => {
    // A mesh's PMX materials, from its primitives' materials (an outline-free copy counts as its original).
    const materials = [
      ...new Set(
        mesh.primitives.map((p) => {
          const name = json.materials[p.material].name.replace(/ \(no outline\)$/, "");
          return model.materials.findIndex((m) => (m.name || m.nameEn) === name);
        }),
      ),
    ];
    const vertices = Uint32Array.from(new Set(materials.flatMap((m) => [...materialVertices(model, m)]))).sort();
    return { mesh: index, node: json.nodes.findIndex((n) => n.mesh === index), name: mesh.name, material: materials[0], materials, vertices };
  });
}

/** The mesh of the material with this name. */
export const meshNamed = (json, model, name) => meshes(json, model).find((m) => m.name === name);

/** A morph target's offsets by PMX vertex, across every mesh it moves. */
export function targetOffsets(json, bin, model, name) {
  /** @type {Map<number, number[]>} */
  const out = new Map();
  for (const m of meshes(json, model)) {
    const index = json.meshes[m.mesh].extras?.targetNames?.indexOf(name) ?? -1;
    if (index < 0) continue;
    const { entries } = sparseEntries(json, bin, json.meshes[m.mesh].primitives[0].targets[index].POSITION);
    for (const [local, offset] of entries) out.set(m.vertices[local], offset);
  }
  return out;
}

/** Whether any mesh has a morph target of this name. */
export const hasTarget = (json, name) => json.meshes.some((mesh) => mesh.extras?.targetNames?.includes(name));

/** An expression's morph binds as [target name, weight], once per name (a target may be bound in several meshes). */
export function bindNames(json, expression) {
  const seen = new Map();
  for (const { node, index, weight } of expression?.morphTargetBinds ?? []) {
    const name = json.meshes[json.nodes[node].mesh].extras.targetNames[index];
    if (!seen.has(name)) seen.set(name, weight);
  }
  return [...seen];
}

/** A primitive's dense vertex data, for skinning checks. */
export function meshAttributes(json, bin, mesh) {
  const { attributes } = json.meshes[mesh].primitives[0];
  return {
    positions: accessorValues(json, bin, attributes.POSITION),
    joints: accessorValues(json, bin, attributes.JOINTS_0),
    weights: accessorValues(json, bin, attributes.WEIGHTS_0),
  };
}
