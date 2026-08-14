from __future__ import annotations

from app.services.scene_planner import Scene


_LIGHTING_COLORS = {
    "ambient_stage_glow": (14, 18, 38),
    "concert_wash": (18, 10, 42),
    "dynamic_beams": (8, 16, 46),
    "dramatic_backlight": (34, 8, 28),
    "fade_to_stage_black": (5, 7, 14),
}


def _hex_rgb(rgb: tuple[int, int, int]) -> str:
    return "0x{:02x}{:02x}{:02x}".format(*rgb)


def _background(scene: Scene) -> str:
    base = _LIGHTING_COLORS.get(scene.lighting, (12, 16, 34))
    lift = int(max(0.0, min(1.0, float(scene.energy))) * 14)
    rgb = tuple(min(255, value + lift) for value in base)
    return _hex_rgb(rgb)


def _scene_filter(scene: Scene, width: int, height: int, index: int) -> str:
    duration = max(scene.end - scene.start, 0.1)
    energy = max(0.0, min(1.0, float(scene.energy)))

    # Keep the generated scene lightweight enough for Render while making it
    # read as a cinematic concert stage rather than a geometric placeholder.
    beam_width = max(70, int(width * (0.045 + energy * 0.055)))
    stage_y = int(height * 0.72)
    stage_h = max(1, height - stage_y)

    performer_w = int(width * (0.09 if scene.shot == "wide_stage" else 0.13))
    performer_h = int(height * (0.34 if scene.shot == "wide_stage" else 0.42))
    performer_x = f"(iw-{performer_w})/2+sin(t*0.45+{index})*{int(width*0.045)}"
    performer_y = f"ih-{performer_h}-ih*0.10"

    head = max(32, int(performer_w * 0.42))
    head_x = f"({performer_x})+({performer_w}-{head})/2"
    head_y = f"({performer_y})-{head+10}"

    torso_w = max(1, int(performer_w * 0.62))
    torso_x = f"({performer_x})+({performer_w}-{torso_w})/2"
    torso_y = f"({performer_y})+{int(performer_h*0.18)}"
    torso_h = max(1, int(performer_h*0.62))

    arm_w = max(12, int(performer_w * 0.25))
    arm_h = max(12, int(performer_h * 0.10))
    leg_w = max(12, int(performer_w * 0.20))
    leg_h = max(20, int(performer_h * 0.34))

    beam_blue = "0x3158d4"
    beam_purple = "0x8d3f91"
    accent = "0xf04b76"
    performer = "0xe7e7ed"
    performer_shadow = "0xbfc1cf"
    stage = "0x0c0d15"
    audience = "0x05060b"
    floor_light = "0x24366e"

    chain = [
        f"color=c={_background(scene)}:s={width}x{height}:r=8:d={duration:.3f}",

        # Soft-looking vertical stage washes built from broad translucent bands.
        f"drawbox=x='mod(t*{width*0.10:.2f},iw+{beam_width*2})-{beam_width*2}':y=0:w={beam_width*2}:h=ih*0.86:color={beam_blue}@0.18:t=fill",
        f"drawbox=x='iw-mod(t*{width*0.07:.2f},iw+{beam_width*2})':y=0:w={beam_width*2}:h=ih*0.86:color={beam_purple}@0.16:t=fill",
        f"drawbox=x='iw*0.48+sin(t*0.35)*iw*0.16':y=0:w={beam_width}:h=ih*0.78:color={accent}@0.15:t=fill",

        # Stage architecture.
        f"drawbox=x=0:y={stage_y}:w=iw:h={stage_h}:color={stage}:t=fill",
        f"drawbox=x=iw*0.08:y='ih*0.70':w=iw*0.84:h='ih*0.025':color={floor_light}@0.75:t=fill",
        f"drawbox=x=iw*0.16:y='ih*0.735':w=iw*0.68:h='ih*0.008':color={accent}@0.9:t=fill",

        # Moving spotlights.
        f"drawbox=x='iw*0.20+sin(t*0.8)*iw*0.12':y='ih*0.05':w={beam_width}:h='ih*0.67':color={beam_blue}@0.22:t=fill",
        f"drawbox=x='iw*0.72+sin(t*0.65+1.4)*iw*0.10':y='ih*0.05':w={beam_width}:h='ih*0.67':color={accent}@0.18:t=fill",

        # Audience silhouettes, intentionally small and low in frame.
        "drawbox=x=iw*0.04:y='ih*0.79':w='iw*0.10':h='ih*0.11':color=" + audience + ":t=fill",
        "drawbox=x=iw*0.17:y='ih*0.81':w='iw*0.08':h='ih*0.09':color=" + audience + ":t=fill",
        "drawbox=x=iw*0.28:y='ih*0.80':w='iw*0.09':h='ih*0.10':color=" + audience + ":t=fill",
        "drawbox=x=iw*0.63:y='ih*0.80':w='iw*0.09':h='ih*0.10':color=" + audience + ":t=fill",
        "drawbox=x=iw*0.75:y='ih*0.81':w='iw*0.08':h='ih*0.09':color=" + audience + ":t=fill",
        "drawbox=x=iw*0.86:y='ih*0.79':w='iw*0.10':h='ih*0.11':color=" + audience + ":t=fill",

        # Central performer: head, torso, raised arms and legs.
        f"drawbox=x='{head_x}':y='{head_y}':w={head}:h={head}:color={performer}:t=fill",
        f"drawbox=x='{torso_x}':y='{torso_y}':w={torso_w}:h={torso_h}:color={performer}:t=fill",
        f"drawbox=x='({torso_x})-{arm_w}':y='({torso_y})+{int(torso_h*0.08)}':w={arm_w}:h={arm_h}:color={performer_shadow}:t=fill",
        f"drawbox=x='({torso_x})+{torso_w}':y='({torso_y})+{int(torso_h*0.08)}':w={arm_w}:h={arm_h}:color={performer_shadow}:t=fill",
        f"drawbox=x='({torso_x})+{int(torso_w*0.10)}':y='({torso_y})+{torso_h}':w={leg_w}:h={leg_h}:color={performer_shadow}:t=fill",
        f"drawbox=x='({torso_x})+{torso_w}-{leg_w-int(performer_w*0.02)}':y='({torso_y})+{torso_h}':w={leg_w}:h={leg_h}:color={performer_shadow}:t=fill",

        # Animated light rail across the stage.
        "drawbox=x='iw*0.10+sin(t*1.1)*iw*0.04':y='ih*0.665':w='iw*0.80':h='ih*0.008':color=" + accent + ":t=fill",
        "format=yuv420p",
    ]

    return f"{','.join(chain)}[v{index}]"


def build_visual_filter(scenes: list[Scene], width: int, height: int) -> str:
    """Build a lightweight animated concert-stage visual from the scene plan."""
    if not scenes:
        raise ValueError("Cannot build visual filter without scenes")

    parts = [
        _scene_filter(scene, width, height, index)
        for index, scene in enumerate(scenes)
    ]
    concat_inputs = "".join(f"[v{index}]" for index in range(len(scenes)))
    return ";".join(parts) + f";{concat_inputs}concat=n={len(scenes)}:v=1:a=0,format=yuv420p[vout]"


__all__ = ["build_visual_filter"]
