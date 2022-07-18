# Using Global Accelerator with on premises SFTP backends

This demo builds 
## Architecture

![Architecture](arc.svg)

## Credentials

- user: sftpuser
- password is stored in secrets manager:

```
aws secretsmanager get-secret-value --secret-id sftpuser --region us-east-2
```