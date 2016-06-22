var request = require('request');
var NativeZip = require("node-native-zip");

module.exports = function(options) {
    options || (options = {});
    if(!options.headers || !options.url) {
        throw new Error('options.headers & options.url are required!');
    }

    options.remotePath = options.remotePath || '/a/domains/frontend.com/deploy/tool/static';
    return function() {
        var bonefs = this.fs;
        var fs = require('fs');
        var version = fs.readFileSync(bonefs.pathResolve('~/dist/version.json'));
        var zipPathRoot = bonefs.pathResolve('~/dist/static_min');
        var zip = new NativeZip();
        // 从远端获取版本号文件
        request.get({
            uri: options.url+'/version.json',
            headers: options.headers
        }, function(err, httpResponse, body) {
            if (err) {
                bone.log.error('fetch version.json failed:', err);
            }

            try {
                var remoteVersion = JSON.parse(body);
            } catch(e) {
                var remoteVersion = {};
            }
            var uploadVersion = {};

            zip.add('version.json', version);
            // 和本地版本号对比，仅上传版本号不同的文件
            version = JSON.parse(version);
            bone.utils.each(version, function(hash, path) {
                if(path in remoteVersion) {
                    if(remoteVersion[path] == hash) {
                        return;
                    }
                }
                uploadVersion[path] = hash;
            });
            if(!bone.utils.size(uploadVersion)) {
                bone.log.info('文件无改变，终止部署！');
                return;
            }
            var zipSize = 0;
            var zipOverflow = false;
            // 添加到zip压缩包内
            bone.utils.each(uploadVersion, function(hash, path) {
                var buffer = fs.readFileSync(zipPathRoot+path);
                zipSize += buffer.length;
                // php 上传文件限制在8M以内，8M之后的文件不添加
                if(zipSize < 7 * 1024 * 1024) {
                    zip.add(path, buffer);
                } else {
                    zipOverflow = true;
                }
            });
            // 远端路径，参数传递用来校验
            var remotePath = options.remotePath;
            request.post({
                uri: options.url+'/deal.php',
                headers: options.headers,
                formData: {
                    zip: {
                        value: zip.toBuffer(),
                        options: {
                            filename: 'dist.zip',
                            contentType: 'application/zip'
                        }
                    },
                    path: 'web'
                }
            }, function(err, httpResponse, body) {
                if (err) {
                    bone.log.error('upload failed:', err);
                }
                try {
                    var info = JSON.parse(body);
                } catch(e) {
                    console.log('statusCode:'+httpResponse.statusCode+' headers:'+JSON.stringify(httpResponse.headers));
                    console.log(body);
                    bone.log.error('部署失败，请重试！');
                }
                if(info.code != 0) {
                    bone.log.error('remote server return info: '+body);
                }

                var detail = {
                    newFile: [],
                    existsFile: [],
                    illegalFile: []
                };

                bone.utils.each(info.data, function(item, path) {
                    if(!item.legal) {
                        if(item.zip_file_not_exitst) return;
                        detail.illegalFile.push({
                            path: path,
                            info: item
                        });
                    } else if(item.isExists) {
                        detail.existsFile.push(path);
                    } else {
                        detail.newFile.push(item.destination);
                    }
                });

                if(detail.newFile.length) {
                    bone.log.info('新增以下文件:');
                    bone.utils.each(detail.newFile, function(path) {
                        var p = path.replace(remotePath, '');
                        bone.log.info('==> ' + '/static'+p);
                    });
                }
                if(detail.existsFile.length) {
                    bone.log.warn('服务器上已存在文件:');
                    bone.utils.each(detail.existsFile, function(path) {
                        bone.log.info(path.replace(remotePath, ''));
                    });
                }
                if(detail.illegalFile.length) {
                    bone.log.warn('服务器校验以下文件非法:');
                    bone.utils.each(detail.illegalFile, function(item) {
                        var p = item.path.replace(remotePath, '');

                        if(item.info.extension_not_avalid) {
                            bone.log.warn(p + ' [非法文件类型，仅限js|css|jpg|jpeg|png|gif|svg|swf|eot|ttf|woff]');
                        } else {
                            bone.log.warn(p + ' [hash不一致] 服务器计算值:' + item.info.md5 + ' => ' + item.info.shortMd5 + ' 请求hash值: ' + item.info.rawHash + '.');
                            bone.log.warn('请release后再次部署!');
                        }
                    });
                }
                if(zipOverflow) {
                    bone.log.warn('部署文件太大，分段上传部署，请再次执行deploy任务！');
                }
            });
        });
    }
};
