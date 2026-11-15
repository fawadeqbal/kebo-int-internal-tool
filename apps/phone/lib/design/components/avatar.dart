import 'package:flutter/material.dart';

import '../theme.dart';

enum KAvatarSize { sm, md, lg }

enum KPresence { online, away, offline }

/// Kestrel › Avatar: a photo, or two initials on a soft tint. Never a broken image.
class KAvatar extends StatelessWidget {
  const KAvatar(this.name, {super.key, this.size = KAvatarSize.md, this.image, this.presence});

  final String name;
  final KAvatarSize size;
  final ImageProvider? image;
  final KPresence? presence;

  static String initials(String name) {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return '?';
    return words.take(2).map((w) => w[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    final (double d, double fs) = switch (size) {
      KAvatarSize.sm => (KSize.avatarSm, 12.0),
      KAvatarSize.md => (KSize.avatar, 15.0),
      KAvatarSize.lg => (KSize.avatarLg, 22.0),
    };
    final dot = switch (presence) {
      KPresence.online => c.success,
      KPresence.away => c.accent,
      KPresence.offline => c.lineStrong,
      null => null,
    };
    return Semantics(
      image: true,
      label: presence == null ? name : '$name, ${presence!.name}',
      child: ExcludeSemantics(
        child: SizedBox.square(
          dimension: d,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                width: d,
                height: d,
                decoration: BoxDecoration(
                  color: c.primarySoft,
                  shape: BoxShape.circle,
                  image: image == null ? null : DecorationImage(image: image!, fit: BoxFit.cover),
                ),
                alignment: Alignment.center,
                child: image == null
                    ? Text(
                        initials(name),
                        style: KType.label.copyWith(fontSize: fs, color: c.onPrimarySoft),
                      )
                    : null,
              ),
              if (dot != null)
                Positioned(
                  right: -1,
                  bottom: -1,
                  child: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: dot,
                      shape: BoxShape.circle,
                      border: Border.all(color: c.surface, width: 2),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
