---
title: 'PNG图片批量压缩'
date: 2020-12-14T23:54:37+08:00
draft: false
---

使用 pngquant 命令行批量压缩 PNG 图片。

pngquant 压缩当前目录下全部 PNG 文件，并且默认全覆盖已有。

```bash
for file in $(ls *.png)
do
pngquant $file --force --output $file
done
```
