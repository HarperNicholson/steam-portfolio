# SteamPortfolio

Track your Steam CS2 inventory value with price history and smart alerts. Built for Steam Deck and Bazzite.

## Download

Go to [Releases](https://github.com/HarperNicholson/steam-portfolio/releases/latest) and download `SteamPortfolio-x.x.x.AppImage`.

## Install

Extract the AppImage once, then run directly — this avoids needing FUSE (required on Steam Deck, Bazzite, and other immutable distros):

```bash
chmod +x SteamPortfolio-*.AppImage
./SteamPortfolio-*.AppImage --appimage-extract
mkdir -p ~/.local/share/SteamPortfolio
mv squashfs-root/* ~/.local/share/SteamPortfolio/
~/.local/share/SteamPortfolio/AppRun
```

To add it to your app launcher:

```bash
mkdir -p ~/.local/share/icons/hicolor/512x512/apps/
cp ~/.local/share/SteamPortfolio/usr/share/icons/hicolor/512x512/apps/steamportfolio.png \
   ~/.local/share/icons/hicolor/512x512/apps/
sed "s|Exec=AppRun.*|Exec=$HOME/.local/share/SteamPortfolio/AppRun|" \
    ~/.local/share/SteamPortfolio/steamportfolio.desktop \
    > ~/.local/share/applications/SteamPortfolio.desktop
update-desktop-database ~/.local/share/applications 2>/dev/null; true
```

Then log out and back in if the launcher entry doesn't appear immediately.

## Features

- Live CS2 inventory prices from the Steam Community Market
- Price history charts per item
- Acquisition cost tracking (manual or auto-imported from Steam history)
- All-time high tracking
- Price alerts with system notifications
- Multi-account support
- Supports any Steam game inventory, not just CS2

## Privacy

Your Steam session cookie (if provided) is stored locally in SQLite and never transmitted anywhere except Steam's own servers. No accounts, no cloud sync, no telemetry.

## License

MIT — see [LICENSE](LICENSE)
