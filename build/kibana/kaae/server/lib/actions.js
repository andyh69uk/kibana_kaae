/*
 * Copyright 2016, Lorenzo Mangani (lorenzo.mangani@gmail.com)
 * Copyright 2015, Rao Chenlin (rao.chenlin@gmail.com)
 *
 * This file is part of KaaE (http://github.com/elasticfence/kaae)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import _ from 'lodash';
import mustache from 'mustache';
import config from './config';
import fs from 'fs';
import getSentinelClient from './get_sentinel_client';

var debug = true;
var hlimit = config.kaae.history ? config.kaae.history : 10;

export default function (server, actions, payload) {

    const client = getSentinelClient(server);
    /* Email Settings */
    if (config.settings.email.active) {
        var email = require("emailjs");
        var email_server = email.server.connect({
            user: config.settings.email.user,
            password: config.settings.email.password,
            host: config.settings.email.host,
            ssl: config.settings.email.ssl
        }, function (err, message) {
            server.log(['status', 'info', 'Kaae', 'email'], err || message);
        });
        // server.smtp.debug(100);
    }

    /* Image Report Settings */
    if (config.settings.report) {
        /* Image Report Settings */
        if (config.settings.report.active && config.settings.email.active) {
            try {
                var Horseman = require('node-horseman');
                var horseman = new Horseman();
            } catch (err) {
                server.log(['status', 'info', 'KaaE'], 'Horseman and PhantomJS required! ' + err);
                server.log(['status', 'info', 'KaaE'], 'Install Horseman: "npm install -g node-horseman"');
            }
        } else {
            server.log(['status', 'info', 'KaaE'], 'Action Report requires Email Settings! Reports Disabled.');
        }
    }

    /* Slack Settings */
    if (config.settings.slack.active) {
        var Slack = require("node-slack");
        var slack = new Slack(config.settings.slack.hook);
    }

    /* Internal Support Functions */
    var tmpHistory = function (type, message) {
        // Keep history stack of latest alarms (temp)
        server.kaaeStore.push({id: new Date(), action: type, message: message});
        // Rotate local stack
        if (server.kaaeStore.length > hlimit) {
            server.kaaeStore.shift();
        }
    };

    /* Debounce Function, returns true if throttled */
    var getDuration = require('sum-time');
    var debounce = function (id, period) {
        var duration = getDuration(period);
        if (duration) {
            var justNow = new Date().getTime();
            if (server.kaaeStore[id] === undefined) {
                server.kaaeStore[id] = justNow;
                return false;
            } else if ((justNow - server.kaaeStore[id]) > duration) {
                server.kaaeStore[id] = justNow;
                return false;
            } else {
                // reject action
                return true;
            }
        } else {
            return false;
        }
    };

    /* ES Indexing Functions */
    var esHistory = function (type, message, loglevel, payload) {
        if (!loglevel) {
            var loglevel = "INFO"
        }
        ;
        if (!payload) {
            var payload = {}
        }
        ;
        server.log(['status', 'info', 'KaaE'], 'Storing Alarm to ES with type:' + type);
        var indexDate = '-' + new Date().toISOString().substr(0, 10).replace(/-/g, '.');
        var index_name = config.es.alarm_index ? config.es.alarm_index + indexDate : 'watcher_alarms' + indexDate;
        client.index({
            index: index_name,
            type: type,
            body: {
                "@timestamp": new Date().toISOString(),
                "level": loglevel,
                "message": message,
                "action": type,
                "payload": payload

            }
        }).then(function (resp) {
            // if (debug) console.log(resp);
        }, function (err, resp) {
            console.trace(err, resp);
        });
    }


    /* Loop Actions */
    _.forOwn(actions, function (action, key) {

        server.log(['status', 'info', 'KaaE'], 'Processing action: ' + key);

        /* ***************************************************************************** */
        /*
         /* Throttle Action based on 'throttle_period' optional parameter
         /* "throttle_period": "5m"
         /*
         /* ***************************************************************************** */
        if (_.has(action, 'throttle_period')) {
            if (debounce(key, action.throttle_period)) {
                server.log(['status', 'info', 'KaaE'], 'Action Throtthled: ' + key);
                return;
            }
        }


        /* ***************************************************************************** */
        /*
         *   "console" : {
         *      "priority" : "DEBUG",
         *      "message" : "Average {{payload.aggregations.avg.value}}"
         *    }
         */

        if (_.has(action, 'console')) {
            var priority = action.console.priority ? action.console.priority : "INFO";
            var formatter_c = action.console.message ? action.console.message : "{{ payload }}";
            var message = mustache.render(formatter_c, {"payload": payload});
            server.log(['status', 'info', 'KaaE'], 'Console Payload: ' + JSON.stringify(payload));
            esHistory(key, message, priority, payload);
        }

        /* ***************************************************************************** */
        /*
         *   "email" : {
         *      "to" : "root@localhost",
         *      "from" : "kaae@localhost",
         *      "subject" : "Alarm Title",
         *      "priority" : "high",
         *      "body" : "Series Alarm {{ payload._id}}: {{payload.hits.total}}",
         *      "stateless" : false
         *	    }
         */

        if (_.has(action, 'email')) {
            var formatter_s = action.email.subject ? action.email.subject : "KAAE: " + key;
            var formatter_b = action.email.body ? action.email.body : "Series Alarm {{ payload._id}}: {{payload.hits.total}}";
            var subject = mustache.render(formatter_s, {"payload": payload});
            var body = mustache.render(formatter_b, {"payload": payload});
            var priority = action.email.priority ? action.email.priority : "INFO";
            server.log(['status', 'info', 'KaaE', 'email'], 'Subject: ' + subject + ', Body: ' + body);

            if (!email_server || !config.settings.email.active) {
                server.log(['status', 'info', 'Kaae', 'email'], 'Delivery Disabled!');
            }
            else {
                server.log(['status', 'info', 'Kaae', 'email'], 'Delivering to Mail Server');
                email_server.send({
                    text: body,
                    from: action.email.from,
                    to: action.email.to,
                    subject: subject
                }, function (err, message) {
                    server.log(['status', 'info', 'Kaae', 'email'], err || message);
                });
            }
            if (!action.email.stateless) {
                // Log Event
                esHistory(key, body, priority, payload);
            }
        }


        /* ***************************************************************************** */
        /*
         *   "email_html" : {
         *      "to" : "root@localhost",
         *      "from" : "kaae@localhost",
         *      "subject" : "Alarm Title",
         *      "priority" : "high",
         *      "body" : "Series Alarm {{ payload._id}}: {{payload.hits.total}}",
         *      "html" : "<p>Series Alarm {{ payload._id}}: {{payload.hits.total}}</p>",
         *      "stateless" : false
         *	    }
         */

        if (_.has(action, 'email_html')) {
            var formatter_s = action.email_html.subject ? action.email_html.subject : "KAAE: " + key;
            var formatter_b = action.email_html.body ? action.email_html.body : "Series Alarm {{ payload._id}}: {{payload.hits.total}}";
            var formatter_c = action.email_html.body ? action.email_html.body : "<p>Series Alarm {{ payload._id}}: {{payload.hits.total}}</p>";
            var subject = mustache.render(formatter_s, {"payload": payload});
            var body = mustache.render(formatter_b, {"payload": payload});
            var html = mustache.render(formatter_c, {"payload": payload});
            var priority = action.email_html.priority ? action.email_html.priority : "INFO";
            server.log(['status', 'info', 'KaaE', 'email_html'], 'Subject: ' + subject + ', Body: ' + body + ', HTML:' + html);

            if (!email_server || !config.settings.email_html.active) {
                server.log(['status', 'info', 'Kaae', 'email_html'], 'Delivery Disabled!');
            }
            else {
                server.log(['status', 'info', 'Kaae', 'email'], 'Delivering to Mail Server');
                email_server.send({
                    text: body,
                    from: action.email_html.from,
                    to: action.email_html.to,
                    subject: subject,
                    attachment: [{data: html, alternative: true}]
                }, function (err, message) {
                    server.log(['status', 'info', 'Kaae', 'email_html'], err || message);
                });
            }
            if (!action.email_html.stateless) {
                // Log Event
                esHistory(key, body, priority, payload);
            }
        }

        /* ***************************************************************************** */
        /*
         *   "report" : {
         *      "to" : "root@localhost",
         *      "from" : "kaae@localhost",
         *      "subject" : "Report Title",
         *      "priority" : "high",
         *      "body" : "Series Report {{ payload._id}}: {{payload.hits.total}}",
         *      "snapshot" : {
         *      		"res" : "1280,900",
         *         "url" : "http://127.0.0.1/app/kibana#/dashboard/Alerts",
         *         "path" : "/tmp/",
         *         "params" : {
         *      				"username" : "username",
         *      				"password" : "password",
         *      				"delay" : 15,
         *             "crop" : false
         *         }
         *       },
         *      "stateless" : false
         *    }
         */

        if (_.has(action, 'report')) {
            var formatter_s = action.report.subject ? action.report.subject : "KAAE: " + key;
            var formatter_b = action.report.body ? action.report.body : "Series Report {{ payload._id}}: {{payload.hits.total}}";
            var subject = mustache.render(formatter_s, {"payload": payload});
            var body = mustache.render(formatter_b, {"payload": payload});
            var priority = action.report.priority ? action.report.priority : "INFO";
            server.log(['status', 'info', 'KaaE', 'report'], 'Subject: ' + subject + ', Body: ' + body);
            if (!email_server) {
                server.log(['status', 'info', 'Kaae', 'report'], 'Reporting Disabled! Email Required!');
                return;
            }
            if (!horseman || !action.report.snapshot) {
                server.log(['status', 'info', 'Kaae', 'report'], 'Reporting Disabled! No Settings!');
                return;
            }
            else {
                //var filename = "report-"+ Math.random().toString(36).substr(2, 9)+".pdf";
                var filename = "report-" + Math.random().toString(36).substr(2, 9) + ".png";
                server.log(['status', 'info', 'Kaae', 'report'], 'Creating Report for ' + action.report.snapshot.url);
                try {
                    horseman
                        .viewport(1280, 900)
                        .open(action.report.snapshot.url)
                        .wait(action.report.snapshot.params.delay)
                        .screenshot(action.report.snapshot.path + filename)
                        //.pdf(action.report.snapshot.path + filename)
                        .then(function () {
                            server.log(['status', 'info', 'Kaae', 'report'], 'Snapshot ready for url:' + action.report.snapshot.url);
                            email_server.send({
                                text: body,
                                from: action.report.from,
                                to: action.report.to,
                                subject: subject,
                                attachment: [
                                    // { path: action.report.snapshot.path + filename, type: "application/pdf", name: filename },
                                    {data: "<html><img src='cid:my-report' width='100%'></html>"},
                                    {
                                        path: action.report.snapshot.path + filename,
                                        type: "image/png",
                                        name: filename + ".png",
                                        headers: {"Content-ID": "<my-report>"}
                                    }
                                ]
                            }, function (err, message) {
                                server.log(['status', 'info', 'Kaae', 'report'], err || message);
                                fs.unlinkSync(action.report.snapshot.path + filename);
                                payload.message = err || message;
                                if (!action.report.stateless) {
                                    // Log Event
                                    esHistory(key, body, priority, payload);
                                }
                            });
                        }).close();
                } catch (err) {
                    server.log(['status', 'info', 'Kaae', 'report'], 'ERROR: ' + err);
                    payload.message = err;
                    if (!action.report.stateless) {
                        // Log Event
                        esHistory(key, body, priority, payload);
                    }
                }
                ;
            }

        }

        /* ***************************************************************************** */
        /*
         *   "slack" : {
         *      "channel": '#<channel>',
         *      "message" : "Series Alarm {{ payload._id}}: {{payload.hits.total}}",
         *      "stateless" : false
         *    }
         */

        if (_.has(action, 'slack')) {
            var formatter = action.slack.message ? action.slack.message : "Series Alarm {{ payload._id}}: {{payload.hits.total}}";
            var message = mustache.render(formatter, {"payload": payload});
            var priority = action.slack.priority ? action.slack.priority : "INFO";
            server.log(['status', 'info', 'KaaE', 'Slack'], 'Webhook to #' + action.slack.channel + ' msg: ' + message);

            if (!slack || !config.settings.slack.active) {
                server.log(['status', 'info', 'KaaE', 'slack'], 'Delivery Disabled!');
            }
            else {
                try {
                    slack.send({
                        text: message,
                        channel: action.slack.channel,
                        username: config.settings.slack.username
                    });
                } catch (err) {
                    server.log(['status', 'info', 'KaaE', 'slack'], 'Failed sending to: ' + condig.settings.slack.hook);
                }
            }

            if (!action.slack.stateless) {
                // Log Event
                esHistory(key, message, priority, payload);
            }

        }

        /* ***************************************************************************** */
        /*
         *   "webhook" : {
         *      "method" : "POST",
         *      "host" : "remote.server",
         *      "port" : 9200,
         *      "path": ":/{{payload.watcher_id}",
         *      "body" : "{{payload.watcher_id}}:{{payload.hits.total}}"
         *    }
         */

        var querystring = require('querystring');
        var http = require('http');
        if (_.has(action, 'webhook')) {

            var webhook_formatter = action.webhook.body ? action.webhook.body : "{{ payload._id}}: {{payload.hits.total}}";
            var webhook_body = mustache.render(webhook_formatter, {"payload": payload});

            var options = {
                hostname: action.webhook.host ? action.webhook.host : 'locahost',
                port: action.webhook.port ? action.webhook.port : 80,
                path: action.webhook.path ? action.webhook.path : '/kaae',
                method: action.webhook.method ? action.webhook.method : 'POST'
            }

            if (action.webhook.headers) options.headers = action.webhook.headers;

            var req = http.request(options, function (res) {
                res.setEncoding('utf8');
                res.on('data', function (chunk) {
                    server.log(['status', 'debug', 'KaaE'], 'Webhook Response: ' + chunk);
                });
            });

            req.on('error', function (e) {
                server.log(['status', 'err', 'KaaE'], 'Error shipping Webhook: ' + e.message);
            });

            if (webhook_body) {
                req.write(webhook_body);
            }
            else if (action.webhook.params) {
                req.write(action.webhook.params);
            }

            req.end();

        }

        /* ***************************************************************************** */
        /*
         *   "elastic" : {
         *      "priority" : "DEBUG",
         *      "message" : "Avg {{payload.aggregations.avg.value}} measurements in 5 minutes"
         *    }
         */
        if (_.has(action, 'elastic')) {
            var es_formater = action.elastic.message ? action.elastic.message : "{{ payload }}";
            var es_message = mustache.render(es_formater, {"payload": payload});
            var priority = action.elastic.priority ? action.elastic.priority : "INFO";
            server.log(['status', 'info', 'KaaE', 'local'], 'Logged Message: ' + es_message);
            // Log Event
            esHistory(key, es_message, priority, payload);
        }

        /* ***************************************************************************** */
        /*      you must set your api key in config.settings.pushapps.api_key
         mandatory parameters are text and at least on element in platforms array, see https://docs.pushapps.mobi/docs/notifications-create-notification for more info
         *   "pushapps" : {
         *      "platforms" : [ "android" , "ios", "web", "fb-messenger", "whatsapp"],
         *      "tags" : [ "<optional tag from PushApps>"],
         *      "campaign_id" : "<optional campaign id from PushApps>",
         *      "text" : "Series Alarm {{ payload._id}}: {{payload.hits.total}}",
         *      "url" : "<optional url to present>",
         *      "image_url" : "<optional image url for the notification or message>"
         *    }
         */

        var querystring = require('querystring');
        var http = require('http');

        if (_.has(action, 'pushapps')) {

            var options = {
                hostname: 'https://api.pushapps.mobi/v1',
                port: 443,
                path: '/notifications',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Api-Key': config.settings.pushapps.api_key
                }
            };

            var post_data = querystring.stringify({
                'text': action.text,
                'platforms': action.platform,
                'tags': action.tags,
                'campaign_id': action.campaign_id,
                'url': action.url,
                'image_url': action.image_url
            });

            var req = http.request(options, function (res) {
                res.setEncoding('utf8');
                res.on('data', function (chunk) {
                    server.log(['status', 'debug', 'KaaE'], 'Response: ' + chunk);
                });
            });

            req.on('error', function (e) {
                server.log(['status', 'err', 'KaaE'], 'Error creating a PushApps notification: ' + e);
            });
            req.write(post_data);
            req.end();

        }

    });

}
