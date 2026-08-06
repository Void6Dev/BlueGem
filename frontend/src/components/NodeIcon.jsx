import {
  User, Users, Flag, MapPin, Calendar, FileText, Sword, Shield, Crown, Skull,
  Heart, Star, Book, Scroll, Sparkles, Globe, Home, Castle, Zap, Flame, Gem,
  Key, Ship, Mountain, Trees, Anchor, Feather, Moon, Circle,
} from "lucide-react";

const MAP = {
  User, Users, Flag, MapPin, Calendar, FileText, Sword, Shield, Crown, Skull,
  Heart, Star, Book, Scroll, Sparkles, Globe, Home, Castle, Zap, Flame, Gem,
  Key, Ship, Mountain, Trees, Anchor, Feather, Moon,
};

export function NodeIcon({ name, className }) {
  const Cmp = MAP[name] || Circle;
  return <Cmp className={className} />;
}

export { MAP as ICON_MAP };
