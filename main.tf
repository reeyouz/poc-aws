terraform {
  cloud {
    organization = "arijit-poc-aws"

    workspaces {
      name = "arijit-poc-aws"
    }
  }
}

resource "aws_instance" "arijit-terraform-test" {
  instance_type = "t2.micro"
  tags = {
    "Name" = "arijit-terraform-test-server"
  }
}