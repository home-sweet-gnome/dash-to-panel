/* SPDX-License-Identifier: GPL-2.0-or-later */

export function parseObject(text) {
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.assign(Object.create(null), value)
  } catch {
    return Object.create(null)
  }
  return Object.create(null)
}

export function appearance(value = {}, symbolic = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {}
  const number = (key, fallback, min, max) =>
    typeof value[key] === 'number' && Number.isFinite(value[key])
      ? Math.max(min, Math.min(max, value[key]))
      : fallback
  return {
    hidden: value.hidden === true,
    icon: typeof value.icon === 'string' ? value.icon : '',
    symbolic:
      value.style === 'symbolic' || (value.style !== 'original' && symbolic),
    saturation: number('saturation', 1, 0, 1),
    brightness: number('brightness', 0, -1, 1),
    contrast: number('contrast', 0, -1, 1),
    tint:
      typeof value.tint === 'string' && /^#[\da-f]{6}$/i.test(value.tint)
        ? value.tint
        : '',
  }
}

export function pixmapToRgba(pixmaps, size) {
  const candidates = (Array.isArray(pixmaps) ? pixmaps : []).filter((entry) => {
    if (!Array.isArray(entry) || entry.length !== 3) return false
    const [width, height, bytes] = entry
    return (
      bytes &&
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0 &&
      width <= 512 &&
      height <= 512 &&
      bytes.length === width * height * 4
    )
  })
  candidates.sort((a, b) => {
    const score = ([width, height]) =>
      Math.abs(Math.max(width, height) - size) +
      (Math.max(width, height) < size ? 512 : 0)
    return score(a) - score(b)
  })
  if (!candidates.length) return null
  const [width, height, argb] = candidates[0]
  const bytes = new Uint8Array(argb.length)
  for (let offset = 0; offset < argb.length; offset += 4) {
    bytes[offset] = argb[offset + 1]
    bytes[offset + 1] = argb[offset + 2]
    bytes[offset + 2] = argb[offset + 3]
    bytes[offset + 3] = argb[offset]
  }
  return { width, height, bytes }
}

export function orderedItems(items, order) {
  const positions = new Map(order.map((id, index) => [id, index]))
  return Array.from(items).sort(
    (a, b) =>
      (positions.get(a.properties.Id) ?? order.length) -
      (positions.get(b.properties.Id) ?? order.length),
  )
}

export function splitTrayItems(items, order, customizations, limit, enabled) {
  const eligible = orderedItems(items, order).filter((item) => {
    const custom = Object.hasOwn(customizations, item.properties.Id)
      ? customizations[item.properties.Id]
      : {}
    return !appearance(custom).hidden && item.properties.Status !== 'Passive'
  })
  const count = enabled ? Math.max(0, Math.floor(limit)) : eligible.length
  return { inline: eligible.slice(0, count), overflow: eligible.slice(count) }
}
