import { Module } from "@nestjs/common";
import { CustomPermissionGuardService } from "./custom-permission-guard.service.js";

@Module({
  providers: [CustomPermissionGuardService],
  exports: [CustomPermissionGuardService],
})
export class CustomPermissionGuardModule {}
