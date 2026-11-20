/* SPDX-License-Identifier: GPL-2.0-or-later */

import Clutter from 'gi://Clutter'
import Cogl from 'gi://Cogl'

export function applyIconEffects(actor, configuration) {
  actor.clear_effects()
  const saturation = configuration.symbolic ? 0 : configuration.saturation
  if (saturation !== 1)
    actor.add_effect(new Clutter.DesaturateEffect({ factor: 1 - saturation }))
  if (configuration.brightness || configuration.contrast) {
    const effect = new Clutter.BrightnessContrastEffect()
    effect.set_brightness(configuration.brightness)
    effect.set_contrast(configuration.contrast)
    actor.add_effect(effect)
  }
  const tint = configuration.tint || (configuration.symbolic ? '#ffffff' : '')
  if (tint) {
    const Color = Cogl.Color || Clutter.Color
    const [valid, color] = Color.from_string(tint)
    if (valid) actor.add_effect(new Clutter.ColorizeEffect({ tint: color }))
  }
}
