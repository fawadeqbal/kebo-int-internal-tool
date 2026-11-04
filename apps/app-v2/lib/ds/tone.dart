/// The five status meanings shared with the web. Colour always comes with words.
enum Tone { neutral, info, ok, warn, bad }

/// A status shown as a small label: "Overdue", "Getting prices".
class Badge {
  const Badge(this.label, this.tone);
  final String label;
  final Tone tone;
}
