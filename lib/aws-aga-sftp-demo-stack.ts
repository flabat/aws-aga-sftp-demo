import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Ec2Action } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AmazonLinuxGeneration, AmazonLinuxImage, CfnEIP, Instance, InstanceClass, InstanceSize, InstanceType, Peer, Port, SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { NetworkLoadBalancer, TargetType } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Accelerator } from 'aws-cdk-lib/aws-globalaccelerator';
import { InstanceEndpoint, NetworkLoadBalancerEndpoint } from 'aws-cdk-lib/aws-globalaccelerator-endpoints';
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnDisk } from 'aws-cdk-lib/aws-lightsail';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class AwsAgaSftpDemoStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'onpremVPC', {
      cidr: '10.20.0.0/16',
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: 'on-prem-public-subnet',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        }
      ]
    });
    
    const sftp_user_password = new Secret(this, 'sftpuser', {
      secretName: 'sftpuser',
      generateSecretString: {
        passwordLength: 14,
      },
    });

    const sftp_server_sg = new SecurityGroup(this, 'sftp_server-sg', {
      vpc
    });

    sftp_server_sg.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(22)
    );

    const sftp_server_role = new Role(this, 'sftp_server_role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite')
      ]
    })

    const sftp_server = new Instance(this, 'sftp_server', {
      instanceType: InstanceType.of(InstanceClass.C5, InstanceSize.XLARGE2),
      machineImage: new AmazonLinuxImage({generation: AmazonLinuxGeneration.AMAZON_LINUX_2}),
      vpc: vpc,
      role: sftp_server_role,
      securityGroup: sftp_server_sg
    })
    
    sftp_server.userData.addCommands(
      'yum update -y',
      'yum install -y jq',
      'REGION=`curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq .region -r`',
      'adduser sftpuser',
      'echo sftpuser:$(aws secretsmanager get-secret-value --secret-id sftpuser --query SecretString --output text --region $REGION) | chpasswd',
      'mkdir -p /var/sftp/files',
      'chown root:root /var/sftp',
      'chmod 755 /var/sftp',
      'chown sftpuser:sftpuser /var/sftp/files',
      'sed -i "s/PasswordAuthentication no/PasswordAuthentication yes/" /etc/ssh/sshd_config',
      'sed -i "s|Subsystem sftp|Subsystem sftp /usr/libexec/openssh/sftp-server" /etc/ssh/sshd_config',
      'echo "Match User sftpuser" >> /etc/ssh/sshd_config',
      'echo "  ChrootDirectory /var/sftp" >> /etc/ssh/sshd_config',
      'echo "  X11Forwarding no" >> /etc/ssh/sshd_config',
      'echo "  AllowTcpForwarding no" >> /etc/ssh/sshd_config',
      'echo "  ForceCommand internal-sftp" >> /etc/ssh/sshd_config',
      'systemctl restart sshd',
      '\n',
    );
    
    const sftp_server_ip_param = new StringParameter(this, 'sftp_server_ip_param', {
      stringValue: sftp_server.instancePublicIp,
      parameterName: 'sftp_server_ip'
    })

    new CfnOutput(this, 'sftp_server_ip', {
      value: sftp_server.instancePublicIp,
      description: 'SFTP Server Public IP'
    })
  }
}

export class AwsAgaSftpDemoStackAGA extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const agavpc = new Vpc(this, 'AGAVPC', {
      cidr: '10.50.0.0/16',
      maxAzs: 2,
      subnetConfiguration: [
        {
          name: 'gateway-public-subnet',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
        }
      ]
    })

    const sftp_gw_sg = new SecurityGroup(this, 'sftp_gw-sg', {
      vpc: agavpc
    });

    sftp_gw_sg.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(22)
    );

    const sftp_gw_role = new Role(this, 'sftp_gw_role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        //ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMFullAccess'),

      ]
    });

    const sftp_gw = new Instance(this, 'sftp_gw', {
      instanceType: InstanceType.of(InstanceClass.C5, InstanceSize.XLARGE2),
      machineImage: new AmazonLinuxImage({generation: AmazonLinuxGeneration.AMAZON_LINUX_2}),
      vpc: agavpc,
      role: sftp_gw_role,
      securityGroup: sftp_gw_sg
    });
    
    const sftp_gw_eip = new CfnEIP(this, 'GWEIP', {
      domain: 'vpc',
      instanceId: sftp_gw.instanceId,
    });

    sftp_gw.userData.addCommands(
      'yum update -y',
      'yum install haproxy -y',
      'sed -i "s/#Port 22/Port 2222/" /etc/ssh/sshd_config',
      'systemctl restart sshd',
      'echo "Enabled=1" > /etc/default/haproxy',
      'echo "listen SSHLB 0.0.0.0:22" >> /etc/haproxy/haproxy.cfg',
      'echo "    mode tcp" >> /etc/haproxy/haproxy.cfg',
      'echo "    option tcplog" >> /etc/haproxy/haproxy.cfg',
      'echo "    balance roundrobin" >> /etc/haproxy/haproxy.cfg',
      'echo "    server sftp01 $(aws ssm get-parameter --name sftp_server_ip --region us-east-2 --output text --query Parameter.Value):22" >> /etc/haproxy/haproxy.cfg',
      'printf "\n" >> /etc/haproxy/haproxy.cfg',
      'systemctl restart haproxy',
      'reboot',
    )

    const accelerator = new Accelerator(this, 'sftpAccelerator');

    const listener = accelerator.addListener('Listener', {
      portRanges: [
        { fromPort: 22 }
      ]
    });

    listener.addEndpointGroup('gwgroup', {
      endpoints: [new InstanceEndpoint(sftp_gw)]
    })

    new CfnOutput(this, 'sftp_gw_eip', {
      value: sftp_gw.instancePublicIp,
      description: 'SFTP Gateway Public IP'
    })

    new CfnOutput(this, 'aga_dns', {
      value: accelerator.dnsName,
      description: 'Accelerator DNS Name'
    })

  }
}