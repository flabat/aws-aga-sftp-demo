#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsAgaSftpDemoStack, AwsAgaSftpDemoStackAGA } from '../lib/aws-aga-sftp-demo-stack';

const app = new cdk.App();
new AwsAgaSftpDemoStack(app, 'AwsAgaSftpDemoStack', {
  
  env: { region: 'us-east-2' },

});

new AwsAgaSftpDemoStackAGA(app, 'AwsAgaSftpDemoStackAGA',{
  env: { region: 'us-east-1' },
})