import 'package:url_launcher/url_launcher.dart';

import '../../../design/design.dart';

/// Call, WhatsApp and mail for a phone and an email; only what exists.
List<KButton> contactActions({String? phone, String? whatsapp, String? email, String? subject}) {
  final chat = (whatsapp ?? phone)?.replaceAll(RegExp(r'[^0-9]'), '');
  return [
    if (phone != null)
      KButton(
        'Call',
        icon: KIcons.phone,
        variant: KButtonVariant.secondary,
        fullWidth: true,
        onPressed: () => launchUrl(Uri.parse('tel:$phone')),
      ),
    if (chat != null && chat.isNotEmpty)
      KButton(
        'Chat',
        icon: KIcons.chat,
        variant: KButtonVariant.secondary,
        fullWidth: true,
        onPressed: () => launchUrl(Uri.parse('https://wa.me/$chat'), mode: LaunchMode.externalApplication),
      ),
    if (email != null)
      KButton(
        'Mail',
        icon: KIcons.mail,
        variant: KButtonVariant.secondary,
        fullWidth: true,
        onPressed: () =>
            launchUrl(Uri.parse('mailto:$email${subject == null ? '' : '?subject=${Uri.encodeComponent(subject)}'}')),
      ),
  ];
}
