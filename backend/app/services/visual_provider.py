from __future__ import annotations

from app.services.scene_planner import Scene


_LIGHTING_COLORS = {
    "ambient_stage_glow": (18, 28, 52),
    "concert_wash": (22, 16, 48),
    "dynamic_beams": (10, 22, 58),
    "dramatic_backlight": (42, 14, 34),
    "fade_to_stage_black": (8, 10, 18),
}


def _hex_rgb(rgb: tuple[int, int, int]) -> str:
    return "0x{:02x}{:02x}{:02x}".format(*rgb)


def _background(scene: Scene) -> str:
    base = _LIGHTING_COLORS.get(scene.lighting, (16, 20, 40))
    lift = int(max(0.0, min(1.0, scene.energy)) * 12)
    rgb = tuple(min(255, value + lift) for value in base)
    return _hex_rgb(rgb)


def _scene_filter(scene: Scene, width: int, height: int, index: int) -> str:
    duration = max(scene.end - scene.start, 0.1)
    energy = max(0.0, min(1.0, float(scene.energy)))

    beam_width = max(90, int(width * (0.08 + energy * 0.08)))
    singer_width = int(width * (0.11 if scene.shot == "wide_stage" else 0.19))
    singer_height = int(height * (0.30 if scene.shot == "wide_stage" else 0.42))

    # Use iw/ih rather than w/h. In drawbox, w and h are the box's own
    # dimensions, so expressions such as h=h are self-referential and fail
    # during filter configuration on current FFmpeg builds.
    singer_x = f"(iw-{singer_width})/2+sin(t*0.55)*{int(width * 0.08)}"
    singer_y = f"ih-{singer_height}-ih*0.12"
    head = max(34, int(singer_width * 0.42))
    head_x = f"({singer_x})+({singer_width}-{head})/2"
    head_y = f"({singer_y})-{head + 12}"

    beam_color = "0x3158d4"
    accent_color = "0xf04b76"
    body_color = "0xe8e8ee"
    dark_color = "0x11131a"

    # Every drawbox stays in the same chain, connected with commas. Semicolons
    # are reserved for separate scene streams and the final concat graph.
    chain = [
        f"color=c={_background(scene)}:s={width}x{height}:r=8:d={duration:.3f}",
        f"drawbox=x='mod(t*{width * 0.22:.2f},iw+{beam_width})-{beam_width}':y=0:w={beam_width}:h=ih:color={beam_color}@0.38:t=fill",
        f"drawbox=x='iw-mod(t*{width * 0.15:.2f},iw+{beam_width})':y=0:w={beam_width}:h=ih:color={accent_color}@0.22:t=fill",
        "drawbox=x=0:y='ih*0.82':w=iw:h='ih*0.18':color=" + dark_color + ":t=fill",
        f"drawbox=x='({singer_x})':y='{singer_y}':w={singer_width}:h={singer_height}:color={body_color}:t=fill",
        f"drawbox=x='{head_x}':y='{head_y}':w={head}:h={head}:color={body_color}:t=fill",
        f"drawbox=x='({singer_x})-{max(18, singer_width // 3)}':y='({singer_y})+{int(singer_height * 0.22)}':w={max(18, singer_width // 3)}:h={max(20, int(singer_height * 0.10))}:color={body_color}:t=fill",
        f"drawbox=x='({singer_x})+{singer_width}':y='({singer_y})+{int(singer_height * 0.22)}':w={max(18, singer_width // 3)}:h={max(20, int(singer_height * 0.10))}:color={body_color}:t=fill",
        "drawbox=x='iw*0.12':y='ih*0.72':w='iw*0.76':h='ih*0.012':color=" + accent_color + ":t=fill",
        "drawbox=x='iw*0.16':y='ih*0.735':w='iw*0.68':h='ih*0.006':color=" + beam_color + ":t=fill",
        "format=yuv420p",
    ]

    return f"{','.join(chain)}[v{index}]"


def build_visual_filter(scenes: list[Scene], width: int, height: int) -> str:
    """Build a low-memory, animated concert visual from the scene plan."""
    if not scenes:
        raise ValueError("Cannot build visual filter without scenes")

    parts = [_scene_filter(scene, width, height, index) for index, scene in enumerate(scenes)]
    concat_inputs = "".join(f"[v{index}]" for index in range(len(scenes)))
    return ";".join(parts) + f";{concat_inputs}concat=n={len(scenes)}:v=1:a=0,format=yuv420p[vout]"


__all__ = ["build_visual_filter"]
