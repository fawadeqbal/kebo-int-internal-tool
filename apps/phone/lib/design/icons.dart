// The Kestrel icon set: 24-grid line icons, 1.75 stroke, round caps (Kestrel › Icon).
// Kept in step with the design system's bundle; add an icon there first.
import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Path data for each icon.
abstract final class KIcons {
  static const back = KIconData('back', 'M15 18l-6-6 6-6');
  static const close = KIconData('close', 'M18 6L6 18M6 6l12 12');
  static const check = KIconData('check', 'M5 12.5l4.5 4.5L19 7');
  static const chevron = KIconData('chevron', 'M9 6l6 6-6 6');
  static const plus = KIconData('plus', 'M12 5v14M5 12h14');
  static const search = KIconData('search', 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4');
  static const home = KIconData('home', 'M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z');
  static const bell = KIconData('bell', 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0');
  static const user = KIconData('user', 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0');
  static const sliders = KIconData('sliders', 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4');
  static const info = KIconData('info', 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 11v5M12 8h.01');
  static const warning = KIconData('warning', 'M12 4L2.5 20h19zM12 10v4M12 17h.01');
  static const success = KIconData('success', 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 10');
  static const error = KIconData('error', 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 8v5M12 16h.01');
  static const heart = KIconData('heart', 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z');
  static const more = KIconData('more', 'M5 12h.01M12 12h.01M19 12h.01');
  static const trash = KIconData('trash', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3');
  static const box = KIconData('box', 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10');
  static const edit = KIconData('edit', 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4');
  static const filter = KIconData('filter', 'M4 6h16M7 12h10M10 18h4');
  static const camera = KIconData('camera', 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7z');
  static const file = KIconData('file', 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6');
  static const upload = KIconData('upload', 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4');
  static const download = KIconData('download', 'M12 4v12M7 11l5 5 5-5M4 20h16');
  static const phone = KIconData(
    'phone',
    'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  );
  static const chat = KIconData('chat', 'M4 5h16v11H9l-5 4zM8 10h8M8 13h5');
  static const mail = KIconData('mail', 'M3 6h18v12H3zM3 7l9 6 9-6');
  static const ship = KIconData('ship', 'M3 15l2 5h14l2-5zM5 15V9h14v6M9 9V5h6v4');
  static const wallet = KIconData('wallet', 'M4 6a2 2 0 0 1 2-2h11v3M3 7h17v13H5a2 2 0 0 1-2-2zM16 13.5h.01');
  static const chart = KIconData('chart', 'M5 20V11M11 20V5M17 20v-7M3 20h18');
  static const calendar = KIconData('calendar', 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4');
  static const clock = KIconData('clock', 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2');
  static const logout = KIconData('logout', 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10');
  static const lock = KIconData('lock', 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3');
  static const users = KIconData(
    'users',
    'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3 6',
  );
  static const factory = KIconData('factory', 'M3 20V10l6 3V9l6 3V5h4v15zM7 17h2M12 17h2');
  static const refresh = KIconData('refresh', 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7');
  static const arrowIn = KIconData('arrow-in', 'M17 7L7 17M7 9v8h8');
  static const arrowOut = KIconData('arrow-out', 'M7 17L17 7M9 7h8v8');
  static const send = KIconData('send', 'M4 12l16-8-6 16-3-7z');
  static const wifiOff = KIconData(
    'wifi-off',
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M15.5 10.4A10 10 0 0 1 19 12.5M12 20h.01',
  );
  static const grid = KIconData('grid', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z');
  static const globe = KIconData(
    'globe',
    'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  );
  static const play = KIconData('play', 'M8 5.5v13l10.5-6.5z');
  static const chevronDown = KIconData('chevron-down', 'M6 9l6 6 6-6');
  static const shield = KIconData('shield', 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6zM9 12l2 2 4-4');
  static const moon = KIconData('moon', 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z');
  static const pin = KIconData(
    'pin',
    'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5z',
  );
}

/// One icon's name and path.
@immutable
class KIconData {
  const KIconData(this.name, this.path);
  final String name;
  final String path;
}

/// Draws a Kestrel icon in the surrounding text colour (or [color]).
/// Decorative unless [label] is given; then it is announced as an image.
class KIcon extends StatelessWidget {
  const KIcon(this.icon, {super.key, this.size = 24, this.color, this.label});

  final KIconData icon;
  final double size;
  final Color? color;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final c = color ?? DefaultTextStyle.of(context).style.color ?? const Color(0xFF161A19);
    final width = icon.name == 'more' ? 2.75 : 1.75;
    final svg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" '
        'stroke-width="$width" stroke-linecap="round" stroke-linejoin="round"><path d="${icon.path}"/></svg>';
    final pic = SvgPicture.string(svg, width: size, height: size, colorFilter: ColorFilter.mode(c, BlendMode.srcIn));
    return label == null ? ExcludeSemantics(child: pic) : Semantics(label: label, image: true, child: pic);
  }
}
