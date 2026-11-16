#!/bin/bash
# 编译 macOS 控制台 App（会替换工作目录占位符）
set -e
cd "$(dirname "$0")/.."
WORKDIR="$PWD"
NODEBIN="$(dirname "$(command -v node)")"
APP="抢购控制.app"

mkdir -p "$APP/Contents/MacOS"
sed -e "s|__WORKDIR__|$WORKDIR|g" -e "s|__NODEBIN__|$NODEBIN|g" tools/pausebtn.swift > /tmp/_pb.swift
swiftc -O /tmp/_pb.swift -o "$APP/Contents/MacOS/抢购控制"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>抢购控制</string>
<key>CFBundleIdentifier</key><string>local.df.pausebtn</string>
<key>CFBundleName</key><string>抢购控制</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
PLIST
echo "已生成 $APP（双击打开）"
