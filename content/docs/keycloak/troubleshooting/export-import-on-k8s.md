---
title: 'Kubernetes中导入导出'
date: 2021-01-10T23:59:00+08:00
draft: false
---

## 问题描述

我的 keycloak 集群是跑在 Kubernetes 上，初始化了一些配置想完整的导出来。

比如按照官方的指导文档，在 keycloak pod 内用下面的命令导出。

```bash
./standalone.sh -Dkeycloak.migration.action=export -Dkeycloak.migration.provider=singleFile -Dkeycloak.migration.file=keycloak-export.json
```

出现类似下面错误。

```log
ERROR [org.jboss.as.controller.management-operation] (Controller Boot Thread) WFLYCTL0013: Operation ("add") failed - address: ([
    ("core-service" => "management"),
    ("management-interface" => "http-interface")
]) - failure description: {
    "WFLYCTL0080: Failed services" => {"org.wildfly.management.http.extensible" => "java.net.BindException: Address already in use /127.0.0.1:9990"},
    "WFLYCTL0288: One or more services were unable to start due to one or more indirect dependencies not being available." => {
        "Services that were unable to start:" => ["org.wildfly.management.http.extensible.shutdown"],
        "Services that may be the cause:" => ["jboss.remoting.remotingConnectorInfoService.http-remoting-connector"]
    }
}
```

## 问题原因

根据错误提示，端口被占用，原因是 keycloak 导出脚本也会启动 Wildfly 服务，默认的 http、https、management 等的端口已经被占用。

## 解决方案

命令行增加环境变量`-Djboss.socket.binding.port-offset=100`，指定不同的服务端口进行导出。

```bash
kubectl -n keycloak exec -it keycloak-0 -- /opt/jboss/keycloak/bin/standalone.sh -Djboss.socket.binding.port-offset=100 -Dkeycloak.migration.action=export -Dkeycloak.migration.provider=dir -Dkeycloak.migration.dir=/tmp
```

导出成功后，Ctrl-C 停止导出的进程，再通过 `kubectl cp` 将文件复制出来。

另外注意导出的文件我放在了 `/tmp` 里，因为 pod 里默认的用户没有写权限。

如果导出的配置比较复杂，比如包含授权策略，导入时还可能会出现以下错误。

```log
FATAL [org.keycloak.services] (ServerService Thread Pool -- 63) java.lang.RuntimeException: Script upload is disabled
```

解决方案，在导入命令里再追加一个环境变量。

```bash
  -Dkeycloak.profile.feature.upload_scripts=enabled
```

## 注意事项

1. 管理控制台也能导入导出，不过导出的不全，比如密码密钥肯定时无法导出的。
2. 导出的文件是普通的 json 文件，可以按照他现有的格式根据需要自己去写，不必每次改动都导出一次。
3. Realm 配置、用户、Client 都可以通过 kcadm.sh 分别导入，所以如果有一些特殊定制，可以考虑将配置分开后独立导入。
