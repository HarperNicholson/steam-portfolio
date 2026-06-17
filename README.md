# SteamPortfolio

Track your Steam CS2 inventory value with price history and smart alerts. Built for the Steam Deck, works on any Linux or Windows machine.

## Download

Go to [Releases](https://github.com/HarperNicholson/steam-portfolio/releases/latest) and grab the file for your platform:

| Platform | File |
|----------|------|
| Linux | `SteamPortfolio-x.x.x.AppImage` |
| Windows | `SteamPortfolio-x.x.x-setup.exe` |

## Install

### Linux (AppImage)

```bash
chmod +x SteamPortfolio-*.AppImage
./SteamPortfolio-*.AppImage
```

To add it to your app launcher and show the icon in your file manager:

```bash
./SteamPortfolio-*.AppImage --appimage-extract
mkdir -p ~/.local/share/icons/hicolor/512x512/apps/
cp squashfs-root/usr/share/icons/hicolor/512x512/apps/steamportfolio.png ~/.local/share/icons/hicolor/512x512/apps/
cp squashfs-root/steamportfolio.desktop ~/.local/share/applications/SteamPortfolio.desktop
sed -i "s|Exec=steamportfolio|Exec=$HOME/Downloads/SteamPortfolio-*.AppImage|" ~/.local/share/applications/SteamPortfolio.desktop
rm -rf squashfs-root
```

Then log out and back in to apply.

### Windows

Run the `-setup.exe` installer, or use the portable `.exe` if you prefer not to install.

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
