import express from "express";
import { success } from "@/lib/responseFormat";
import db from "@/utils/db";
import type { DB } from "@/types/database";
import knex from "knex";
import path from "path";
import fs from "fs";
import { tr } from "zod/locales";

const router = express.Router();

// 迁移数据
export default router.post(
    "/",
    async (req, res) => {
        // return res.status(200).send({
        //     success: true,
        //     message: '数据迁移功能已关闭，建议手动迁移数据后删除旧数据库文件'
        // });
        //连接旧数据库，读取数据
        try {
            let db2: knex.Knex | null = null;
            //读取旧数据库路径
            let db2Path: string;
            if (typeof process.versions?.electron !== "undefined") {
                const { app } = require("electron");
                const userDataDir: string = app.getPath("userData");
                db2Path = path.join(userDataDir, "db2.sqlite");
            } else {
                db2Path = path.join(process.cwd(), "db2.sqlite");
            }
            const dbDir = path.dirname(db2Path);
            // 确保数据库目录存在
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
            if (!fs.existsSync(db2Path)) {
                return res.status(404).send({
                    success: false,
                    message: `源数据库文件不存在: ${db2Path}`
                });
            }
            //连接旧数据库
            db2 = knex({
                client: "better-sqlite3",
                connection: {
                    filename: db2Path,
                },
                useNullAsDefault: true,
            });
            //需要迁移的旧数据表
            const db2TableNames = [
                't_project',
                't_assets',
                't_event',
                't_image',
                't_novel',
                't_outline',
                't_script',
                't_storyboard',
                't_video',
            ]
            //新数据库的表
            const dbTableNames = [
                'o_project',
                'o_assets',
                'o_event',
                'o_eventChapter',
                'o_image',
                'o_novel',
                'o_outline',
                'o_outlineNovel',
                'o_script',
                'o_scriptAssets',
                'o_scriptOutline',
                'o_storyboard',
                'o_storyboardScript',
                'o_video',
            ]

            for (const tableName of db2TableNames) {
                try {
                    // 从 db2 读取数据
                    const sourceData = await db2(tableName).select('*');
                    for (const item of sourceData) {
                        //迁移项目表
                        if (tableName === 't_project') {
                            // await db("o_project").insert({
                            //     name: item.name,
                            //     intro: item.intro,
                            //     type: item.type,
                            //     artStyle: item.artStyle,
                            //     videoRatio: item.videoRatio,
                            //     createTime: item.createTime,
                            //     userId: item.userId,
                            //     projectType: "基于小说原文"
                            // })
                        }
                        //迁移资产表
                        if (tableName === 't_assets') {
                        }
                        //迁移事件表
                        if (tableName === 't_event') { }
                        //迁移图片表
                        if (tableName === 't_image') { }
                        //迁移小说表
                        if (tableName === 't_novel') { }
                        //迁移大纲表
                        if (tableName === 't_outline') { }
                        //迁移脚本表
                        if (tableName === 't_script') { }
                        //迁移分镜面板
                        if (tableName === 't_storyboard') { }
                        //迁移视频表
                        if (tableName === 't_video') { }
                    }
                    // // 将数据插入到 db 中
                    // const targetTableName = dbTableNames[db2TableNames.indexOf(tableName)];
                    // await db(targetTableName).insert(sourceData);
                    // console.log(`成功迁移表 ${tableName} 的数据到 ${targetTableName}`);
                } catch (error) {
                    console.error(`连接旧数据库失败: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            console.error('连接旧数据库失败:', error);
        }
        return res.status(200).send({
            success: true,
            message: '数据迁移功能已关闭，建议手动迁移数据后删除旧数据库文件'
        });
    }
);
